import type { Prisma } from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import type { ProposedSignal } from "@/modules/providers/ai";

/**
 * Stores what the Agent heard as a PENDING signal. Nothing proposed by the
 * model becomes matchable before the user confirms it, and AI inferences are
 * kept separate from what the user actually said.
 */
export async function recordProposedSignals(
  tx: Prisma.TransactionClient,
  userId: string,
  messageId: string,
  signals: ProposedSignal[],
): Promise<number> {
  let stored = 0;
  for (const signal of signals) {
    // An active duplicate adds nothing, and a signal the user already rejected
    // must not be recreated by the same phrase turning up again.
    const suppressed = await tx.relationshipSignal.findFirst({
      where: {
        userId,
        category: signal.category,
        key: signal.key,
        value: signal.value,
        OR: [{ supersededAt: null }, { reviewStatus: "REJECTED" }],
      },
    });
    if (suppressed) continue;
    await tx.relationshipSignal.create({
      data: {
        userId,
        category: signal.category,
        key: signal.key,
        value: signal.value,
        source: signal.source,
        sourceMessageId: messageId,
        evidenceQuote: signal.evidenceQuote,
        confidence: signal.confidence,
        matchable: false,
        reviewStatus: "PENDING",
      },
    });
    stored += 1;
  }
  return stored;
}

/**
 * Confirmation is the only path from hypothesis to matchable fact. Confirmed
 * identity facts also land on the user record, and confirmed boundaries become
 * hard filters that outrank any later inference.
 */
export async function confirmSignal(userId: string, signalId: string) {
  const signal = await prisma.relationshipSignal.findUnique({ where: { id: signalId } });
  if (!signal || signal.userId !== userId) return null;

  return prisma.$transaction(async (tx) => {
    const confirmed = await tx.relationshipSignal.update({
      where: { id: signalId },
      data: { reviewStatus: "CONFIRMED", userConfirmed: true, matchable: true },
    });

    if (signal.category === "identity") {
      if (signal.key === "age" && /^\d{1,3}$/.test(signal.value)) {
        await tx.user.update({
          where: { id: userId },
          data: { ageYears: Number(signal.value) },
        });
      }
      if (signal.key === "city") {
        await tx.user.update({ where: { id: userId }, data: { city: signal.value } });
      }
    }

    if (signal.category === "boundary") {
      const existing = await tx.preference.findFirst({
        where: { userId, category: signal.category, key: signal.key, supersededAt: null },
      });
      if (existing) {
        await tx.preference.update({
          where: { id: existing.id },
          data: { value: signal.value, isHardFilter: true },
        });
      } else {
        await tx.preference.create({
          data: {
            userId,
            category: signal.category,
            key: signal.key,
            value: signal.value,
            isHardFilter: true,
          },
        });
      }
    }

    return confirmed;
  });
}

export async function rejectSignal(userId: string, signalId: string) {
  const signal = await prisma.relationshipSignal.findUnique({ where: { id: signalId } });
  if (!signal || signal.userId !== userId) return null;
  return prisma.relationshipSignal.update({
    where: { id: signalId },
    data: {
      reviewStatus: "REJECTED",
      userConfirmed: false,
      matchable: false,
      supersededAt: new Date(),
    },
  });
}

/** Confirmed, matchable facts only — this is what the Agent is allowed to recite. */
export async function confirmedFacts(userId: string) {
  const signals = await prisma.relationshipSignal.findMany({
    where: { userId, reviewStatus: "CONFIRMED", supersededAt: null },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  return signals.map((s) => ({ key: s.key, value: s.value }));
}

export async function pendingSignals(userId: string) {
  return prisma.relationshipSignal.findMany({
    where: { userId, reviewStatus: "PENDING", supersededAt: null },
    orderBy: { createdAt: "desc" },
  });
}
