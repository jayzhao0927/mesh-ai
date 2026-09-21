import { prisma } from "@/modules/shared/db";
import { handleInboundMessage } from "@/modules/agent/runtime";
import { flushOutbox } from "./outbox";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

/**
 * Leases pending Agent jobs one at a time per user so a single conversation is
 * processed in order, then flushes the outbox. Safe to call repeatedly: a
 * crashed run only releases its lease on expiry and is retried.
 */
export async function runWorkerOnce(limit = 10): Promise<{ processed: number; sent: number }> {
  const now = new Date();
  const jobs = await prisma.agentJob.findMany({
    where: {
      status: { in: ["PENDING", "LEASED"] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const seenUsers = new Set<string>();
  let processed = 0;

  for (const job of jobs) {
    if (job.userId && seenUsers.has(job.userId)) continue;
    if (job.userId) seenUsers.add(job.userId);

    const leased = await prisma.agentJob.updateMany({
      where: { id: job.id, attempts: job.attempts, status: job.status },
      data: {
        status: "LEASED",
        attempts: job.attempts + 1,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      },
    });
    if (leased.count === 0) continue;

    try {
      if (job.userId && job.conversationId && job.messageId) {
        await handleInboundMessage({
          userId: job.userId,
          conversationId: job.conversationId,
          messageId: job.messageId,
          jobId: job.id,
        });
      }
      await prisma.agentJob.update({
        where: { id: job.id },
        data: { status: "DONE", leaseExpiresAt: null },
      });
      processed += 1;
    } catch (error) {
      await prisma.agentJob.update({
        where: { id: job.id },
        data: {
          status: job.attempts + 1 >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
          lastError: error instanceof Error ? error.message : String(error),
          leaseExpiresAt: null,
        },
      });
    }
  }

  const sent = await flushOutbox();
  return { processed, sent };
}
