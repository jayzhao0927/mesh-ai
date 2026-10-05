import { prisma } from "@/modules/shared/db";
import { aiProvider } from "@/modules/providers/ai";
import { recentTurns } from "@/modules/messaging/conversation";
import { enqueueOutbound } from "@/modules/messaging/outbox";
import { confirmedFacts, recordProposedSignals } from "@/modules/relationship/service";
import { runTool } from "./tools";

/** User content only reaches an external model with third-party consent. */
async function externalProcessingAllowed(userId: string): Promise<boolean> {
  const consent = await prisma.consentRecord.findFirst({
    where: { userId, scope: "THIRD_PARTY_PROCESSING" },
    orderBy: { createdAt: "desc" },
  });
  return consent?.granted === true;
}

export interface TurnResult {
  reply: string;
  signalsRecorded: number;
  toolResults: { name: string; ok: boolean; message: string }[];
}

/**
 * Handles one inbound message: builds bounded context, asks the provider,
 * runs the tools it requested through validation, and enqueues the reply in
 * the same transaction as the memory changes.
 */
export async function handleInboundMessage(params: {
  userId: string;
  conversationId: string;
  messageId: string;
  jobId: string;
}): Promise<TurnResult> {
  const message = await prisma.message.findUnique({ where: { id: params.messageId } });
  if (!message?.text) {
    return { reply: "", signalsRecorded: 0, toolResults: [] };
  }

  const provider = aiProvider();
  if (provider.name !== "mock" && !(await externalProcessingAllowed(params.userId))) {
    return handleConsentTurn(params, message.text);
  }

  const [turns, facts, profile] = await Promise.all([
    recentTurns(params.conversationId),
    confirmedFacts(params.userId),
    prisma.relationshipProfile.findUnique({ where: { userId: params.userId } }),
  ]);

  const output = await provider.respond({
    recentTurns: turns.filter((t) => t.text !== message.text),
    summary: profile?.summary ?? undefined,
    knownFacts: facts,
    message: message.text,
  });

  const toolResults: TurnResult["toolResults"] = [];
  const toolTexts: string[] = [];
  for (const call of output.toolCalls) {
    const result = await runTool({ userId: params.userId }, call.name, call.args);
    toolResults.push({ name: call.name, ok: result.ok, message: result.message });
    const text = agentTextOf(result.data);
    if (text) toolTexts.push(text);
  }

  // What actually happened in the domain outranks whatever the model drafted.
  const reply = toolTexts.length > 0 ? toolTexts.join("\n\n") : output.reply;

  const signalsRecorded = await prisma.$transaction(async (tx) => {
    const count = await recordProposedSignals(
      tx,
      params.userId,
      params.messageId,
      output.proposedSignals,
    );
    if (reply) {
      await enqueueOutbound(tx, {
        conversationId: params.conversationId,
        text: reply,
        dedupeKey: `reply:${params.jobId}`,
      });
    }
    return count;
  });

  return { reply, signalsRecorded, toolResults };
}

const AGREEMENT = /^\s*(同意|我同意|好的?|可以|agree|i agree|yes|ok|okay)\s*[。.!！]?\s*$/i;

function consentPrompt(text: string): string {
  return /[\u4e00-\u9fff]/.test(text)
    ? "在我们开始之前：为了理解你，我需要把你发给我的消息交给第三方 AI 模型（OpenAI）处理。回复「同意」即表示你允许；不同意的话我不会处理你的消息内容。"
    : "Before we start: to understand you, I need to send your messages to a third-party AI model (OpenAI). Reply \"agree\" to allow it — until then I won't process what you write.";
}

function consentThanks(text: string): string {
  return /[\u4e00-\u9fff]/.test(text)
    ? "谢谢你。先从简单的开始吧：你最近在忙些什么？"
    : "Thank you. Let's start simple: what's keeping you busy these days?";
}

/**
 * Without third-party consent, user content is never sent to the external
 * model. The only thing the Agent does is ask for that consent and record an
 * explicit agreement.
 */
async function handleConsentTurn(
  params: { userId: string; conversationId: string; jobId: string },
  text: string,
): Promise<TurnResult> {
  const agreed = AGREEMENT.test(text);
  const reply = agreed ? consentThanks(text) : consentPrompt(text);
  await prisma.$transaction(async (tx) => {
    if (agreed) {
      await tx.consentRecord.create({
        data: {
          userId: params.userId,
          scope: "THIRD_PARTY_PROCESSING",
          granted: true,
          source: "messaging",
        },
      });
    }
    await enqueueOutbound(tx, {
      conversationId: params.conversationId,
      text: reply,
      dedupeKey: `reply:${params.jobId}`,
    });
  });
  return { reply, signalsRecorded: 0, toolResults: [] };
}

function agentTextOf(data: unknown): string | null {
  if (data && typeof data === "object" && "agentText" in data) {
    const value = (data as { agentText: unknown }).agentText;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
