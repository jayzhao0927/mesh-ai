import { env } from "@/config/env";
import { DomainError } from "@/modules/shared/errors";
import { AGENT_SYSTEM_PROMPT, buildUserPrompt, OUTPUT_JSON_SCHEMA } from "./prompt";
import type { AIProvider, AgentTurnInput, AgentTurnOutput, ProposedSignal } from "./types";

const API_URL = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
}

/**
 * Real OpenAI-backed agent turn. Output is constrained by a JSON schema, and
 * everything it returns is still only a proposal: signals arrive as PENDING and
 * tool calls go through the validated registry with a server-bound user id.
 *
 * The runtime refuses to select this provider without THIRD_PARTY_PROCESSING
 * consent, so no user content reaches OpenAI before the user agrees.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  async respond(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const { OPENAI_API_KEY, OPENAI_MODEL } = env();
    if (!OPENAI_API_KEY) {
      throw new DomainError("OPENAI_API_KEY is not configured", "CONFIG_ERROR", 500);
    }

    const body = {
      model: OPENAI_MODEL,
      temperature: 0.6,
      messages: [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "mesh_agent_turn", strict: true, schema: OUTPUT_JSON_SCHEMA },
      },
    };

    const raw = await this.callWithRetry(OPENAI_API_KEY, body);
    return parseTurn(raw);
  }

  private async callWithRetry(apiKey: string, body: unknown): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.call(apiKey, body);
      } catch (error) {
        lastError = error;
        // A rejected request (bad key, bad model, content refusal) will not fix
        // itself; only transient failures are worth another attempt.
        if (error instanceof DomainError && error.code === "PROVIDER_REJECTED") throw error;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new DomainError("OpenAI request failed", "PROVIDER_ERROR", 502);
  }

  private async call(apiKey: string, body: unknown): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        const retryable = response.status === 429 || response.status >= 500;
        throw new DomainError(
          `OpenAI responded ${response.status}: ${detail}`,
          retryable ? "PROVIDER_ERROR" : "PROVIDER_REJECTED",
          502,
        );
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new DomainError("OpenAI returned no content", "PROVIDER_ERROR", 502);
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

const ALLOWED_SOURCES = new Set(["USER_STATED", "AI_INFERENCE"]);

/**
 * Model output is untrusted input: anything that does not fit the contract is
 * dropped rather than passed on to the domain.
 */
export function parseTurn(raw: string): AgentTurnOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainError("OpenAI returned malformed JSON", "PROVIDER_ERROR", 502);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new DomainError("OpenAI returned a non-object turn", "PROVIDER_ERROR", 502);
  }

  const turn = parsed as Record<string, unknown>;
  const reply = typeof turn.reply === "string" ? turn.reply.trim() : "";

  const proposedSignals: ProposedSignal[] = [];
  if (Array.isArray(turn.proposedSignals)) {
    for (const entry of turn.proposedSignals) {
      if (typeof entry !== "object" || entry === null) continue;
      const signal = entry as Record<string, unknown>;
      const category = typeof signal.category === "string" ? signal.category.trim() : "";
      const key = typeof signal.key === "string" ? signal.key.trim() : "";
      const value = typeof signal.value === "string" ? signal.value.trim() : "";
      const source = typeof signal.source === "string" ? signal.source : "";
      if (!category || !key || !value || !ALLOWED_SOURCES.has(source)) continue;
      const confidence = typeof signal.confidence === "number" ? signal.confidence : 0.5;
      const evidenceQuote =
        typeof signal.evidenceQuote === "string" && signal.evidenceQuote.length > 0
          ? signal.evidenceQuote
          : undefined;
      proposedSignals.push({
        category,
        key,
        value,
        source: source as ProposedSignal["source"],
        confidence: Math.min(Math.max(confidence, 0), 1),
        evidenceQuote,
      });
    }
  }

  const toolCalls: AgentTurnOutput["toolCalls"] = [];
  if (Array.isArray(turn.toolCalls)) {
    for (const entry of turn.toolCalls) {
      if (typeof entry !== "object" || entry === null) continue;
      const call = entry as Record<string, unknown>;
      const name = typeof call.name === "string" ? call.name.trim() : "";
      if (!name) continue;
      // Strict-schema tool calls carry every optional argument as a nullable
      // field; only the ones the model actually set become arguments.
      const args: Record<string, unknown> = {};
      if (typeof call.intent === "string") args.intent = call.intent;
      if (typeof call.state === "string") args.state = call.state;
      if (toolCalls.some((existing) => existing.name === name)) continue;
      toolCalls.push({ name, args });
    }
  }

  return { reply, proposedSignals, toolCalls };
}
