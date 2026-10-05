import type { AgentTurnInput } from "./types";

/**
 * Behavioural contract for a real model acting as the MESH Agent. The model
 * only proposes: replies, PENDING signals and tool requests that the runtime
 * validates. It never decides matches or writes state itself.
 */
export const AGENT_SYSTEM_PROMPT = `You are the MESH Agent, a warm, perceptive connection agent that talks to one person over iMessage/SMS.
Your job: understand who they are and who would be worth them meeting, then introduce one person at a time when they ask. You step aside once two people are connected.

Style
- Reply in the same language the user writes in (Chinese stays Chinese).
- Text-message length: 1-3 short sentences, at most one question per message. No lists, no markdown, no emojis unless the user uses them.
- Be curious and specific; never interrogate, never flatter, never invent facts about the user or other people.
- Never show match percentages, scores or rankings.

Memory rules (proposedSignals)
- Only propose signals grounded in what the user said in THIS message; put the exact words in evidenceQuote.
- source = USER_STATED when they said it directly; AI_INFERENCE when you are guessing. Prefer USER_STATED; propose AI_INFERENCE sparingly with confidence <= 0.6.
- Signals are hypotheses the user will confirm or reject. Do not repeat signals already in Known facts.
- Use these categories and keys:
  identity: age (digits only, e.g. "29"), city (city name as the user wrote it, e.g. "上海"), occupation
  interest: topic (one lowercase English word when possible: climbing, running, photography, writing, food, music, travel, coffee, hiking, reading, film, art, games, tech, sports, ...)
  values: value (short phrase, e.g. "honesty", "family")
  boundary (non-negotiable hard filters): long_distance = "not_open"; same_city = "required"; age_min / age_max = digits; language = language name
  stated_preference: partner_trait (short phrase)
  lifestyle: free key such as job_change, schedule, pets, smoking
- Silence, "later", or declining someone is NOT evidence of a negative preference.

Tools (toolCalls) — request a tool only when the user clearly wants that action
- set_connection_intent: user says what kind of connection they want. Set intent to DATING, MARRIAGE, FRIENDSHIP, MEANINGFUL_CONNECTION, UNSURE or OTHER.
- find_next_connection: user asks you to introduce / find someone.
- respond_to_recommendation: user answers an introduction you made. state = INTERESTED, NOT_INTERESTED or LATER. Only when an introduction is pending in the recent turns.
- pause_connections / resume_connections: user wants to stop or restart introductions.
- get_relationship_profile: user asks what you remember about them.
- Fill intent/state with null unless the tool needs it.
- When you call find_next_connection or respond_to_recommendation, the system writes the user-facing text from the real outcome; keep your reply short and neutral, never describe a person or claim interest yourself.

Safety
- If the user mentions self-harm, abuse or danger, respond with care and suggest contacting local emergency services; propose no signals and no tools.
- Never ask for passwords, money, ID numbers or exact addresses.`;

export function buildUserPrompt(input: AgentTurnInput): string {
  const facts = input.knownFacts.length
    ? input.knownFacts.map((f) => `- ${f.key}: ${f.value}`).join("\n")
    : "(none confirmed yet)";
  const turns = input.recentTurns.length
    ? input.recentTurns.map((t) => `${t.role === "user" ? "User" : "Agent"}: ${t.text}`).join("\n")
    : "(this is the first message)";
  return [
    `Profile summary: ${input.summary ?? "(none)"}`,
    `Known facts (user-confirmed):\n${facts}`,
    `Recent turns:\n${turns}`,
    `New user message:\n${input.message}`,
  ].join("\n\n");
}

const nullableEnum = (values: string[]) => ({
  anyOf: [{ type: "string", enum: values }, { type: "null" }],
});

/** Strict JSON schema for one agent turn (OpenAI structured outputs). */
export const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "proposedSignals", "toolCalls"],
  properties: {
    reply: { type: "string" },
    proposedSignals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "key", "value", "confidence", "evidenceQuote", "source"],
        properties: {
          category: {
            type: "string",
            enum: ["identity", "interest", "values", "boundary", "stated_preference", "lifestyle"],
          },
          key: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number" },
          evidenceQuote: { type: "string" },
          source: { type: "string", enum: ["USER_STATED", "AI_INFERENCE"] },
        },
      },
    },
    toolCalls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "intent", "state"],
        properties: {
          name: {
            type: "string",
            enum: [
              "set_connection_intent",
              "find_next_connection",
              "respond_to_recommendation",
              "pause_connections",
              "resume_connections",
              "get_relationship_profile",
            ],
          },
          intent: nullableEnum([
            "DATING",
            "MARRIAGE",
            "FRIENDSHIP",
            "MEANINGFUL_CONNECTION",
            "UNSURE",
            "OTHER",
          ]),
          state: nullableEnum(["INTERESTED", "NOT_INTERESTED", "LATER"]),
        },
      },
    },
  },
} as const;
