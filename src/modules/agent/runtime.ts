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
    throw new Error(
      "Third-party processing consent is missing; refusing to send user content to an external model",
    );
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
  for (const call of output.toolCalls) {
    const result = await runTool({ userId: params.userId }, call.name, call.args);
    toolResults.push({ name: call.name, ok: result.ok, message: result.message });
  }

  const signalsRecorded = await prisma.$transaction(async (tx) => {
    const count = await recordProposedSignals(
      tx,
      params.userId,
      params.messageId,
      output.proposedSignals,
    );
    if (output.reply) {
      await enqueueOutbound(tx, {
        conversationId: params.conversationId,
        text: output.reply,
        dedupeKey: `reply:${params.jobId}`,
      });
    }
    return count;
  });

  return { reply: output.reply, signalsRecorded, toolResults };
}
