import { Prisma } from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import { messagingProvider } from "@/modules/providers/messaging";

const LEASE_MS = 30_000;

/** Enqueue inside the same transaction that persists the state change. */
export async function enqueueOutbound(
  tx: Prisma.TransactionClient,
  params: { conversationId: string; text: string; dedupeKey: string },
): Promise<void> {
  await tx.outboxMessage.upsert({
    where: { dedupeKey: params.dedupeKey },
    update: {},
    create: {
      dedupeKey: params.dedupeKey,
      conversationId: params.conversationId,
      text: params.text,
    },
  });
}

export async function flushOutbox(limit = 20): Promise<number> {
  const now = new Date();
  const candidates = await prisma.outboxMessage.findMany({
    where: {
      status: { in: ["PENDING", "LEASED"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let sent = 0;
  for (const item of candidates) {
    const leased = await prisma.outboxMessage.updateMany({
      where: { id: item.id, status: item.status, attempts: item.attempts },
      data: {
        status: "LEASED",
        attempts: item.attempts + 1,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      },
    });
    if (leased.count === 0) continue;

    const conversation = await prisma.conversation.findUnique({
      where: { id: item.conversationId },
    });
    if (!conversation) {
      await prisma.outboxMessage.update({
        where: { id: item.id },
        data: { status: "FAILED", lastError: "conversation missing" },
      });
      continue;
    }

    try {
      const result = await messagingProvider().sendText(
        conversation.externalConversationId,
        item.text,
        item.dedupeKey,
      );
      if (result.status === "UNKNOWN") {
        // Never blind-retry an undetermined send.
        await prisma.outboxMessage.update({
          where: { id: item.id },
          data: { status: "NEEDS_RECONCILIATION", providerRef: result.providerRef },
        });
        continue;
      }
      await prisma.$transaction([
        prisma.outboxMessage.update({
          where: { id: item.id },
          data: { status: "DONE", providerRef: result.providerRef, leaseExpiresAt: null },
        }),
        prisma.message.create({
          data: {
            conversationId: item.conversationId,
            direction: "OUTBOUND",
            type: "TEXT",
            text: item.text,
            provider: conversation.provider,
            externalMessageId: item.dedupeKey,
            receivedAt: new Date(),
          },
        }),
      ]);
      sent += 1;
    } catch (error) {
      await prisma.outboxMessage.update({
        where: { id: item.id },
        data: {
          status: item.attempts >= 4 ? "FAILED" : "PENDING",
          lastError: error instanceof Error ? error.message : String(error),
          leaseExpiresAt: null,
        },
      });
    }
  }
  return sent;
}
