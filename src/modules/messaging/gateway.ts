import { Prisma } from "@prisma/client";
import { sha256 } from "@/modules/shared/crypto";
import { ConflictError } from "@/modules/shared/errors";
import { prisma } from "@/modules/shared/db";
import type { InboundMessage } from "@/modules/providers/messaging";
import { getOrCreateConversation } from "./conversation";
import { resolveUser } from "./identity";

export type IngestOutcome =
  | { status: "ACCEPTED"; messageId: string; jobId: string; userId: string }
  | { status: "DUPLICATE" }
  | { status: "IGNORED"; reason: string };

/**
 * Persists an inbound message and enqueues exactly one Agent job for it before
 * the webhook is acknowledged. Redelivery of the same external message id is a
 * no-op; the same id carrying different content is rejected as a conflict.
 */
export async function ingestInbound(
  message: InboundMessage,
  payloadHash: string,
): Promise<IngestOutcome> {
  if (message.isGroup) return { status: "IGNORED", reason: "group message" };
  if (message.isFromAgent) return { status: "IGNORED", reason: "agent echo" };
  if (message.messageType === "SYSTEM") return { status: "IGNORED", reason: "system message" };

  const contentHash = sha256(`${message.text ?? ""}|${message.mediaUrl ?? ""}`);

  const existingMessage = await prisma.message.findUnique({
    where: {
      provider_externalMessageId: {
        provider: message.provider,
        externalMessageId: message.externalMessageId,
      },
    },
  });
  if (existingMessage) {
    if (existingMessage.contentHash !== contentHash) {
      throw new ConflictError(
        "External message id already seen with different content",
      );
    }
    return { status: "DUPLICATE" };
  }

  const user = await resolveUser({
    provider: message.provider,
    channel: message.channel,
    externalId: message.senderExternalId,
  });
  const conversation = await getOrCreateConversation({
    userId: user.id,
    provider: message.provider,
    channel: message.channel,
    externalConversationId: message.externalConversationId,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const stored = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          type: message.messageType,
          text: message.text,
          mediaUrl: message.mediaUrl,
          provider: message.provider,
          externalMessageId: message.externalMessageId,
          contentHash,
          receivedAt: message.receivedAt,
        },
      });
      await tx.webhookReceipt.create({
        data: {
          provider: message.provider,
          externalMessageId: message.externalMessageId,
          payloadHash,
        },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.receivedAt },
      });
      const job = await tx.agentJob.create({
        data: {
          dedupeKey: `agent:${message.provider}:${message.externalMessageId}`,
          userId: user.id,
          conversationId: conversation.id,
          messageId: stored.id,
        },
      });
      return {
        status: "ACCEPTED" as const,
        messageId: stored.id,
        jobId: job.id,
        userId: user.id,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { status: "DUPLICATE" };
    }
    throw error;
  }
}
