import { prisma } from "@/modules/shared/db";
import { sha256 } from "@/modules/shared/crypto";
import { verificationProvider } from "@/modules/providers/verification";
import { DomainError } from "@/modules/shared/errors";

/**
 * Starts verification and returns the one-time token. Only the hash is stored,
 * so the raw token cannot be recovered from the database.
 */
export async function startVerification(userId: string): Promise<{ token: string }> {
  const provider = verificationProvider();
  const started = await provider.start(userId);
  await prisma.verification.create({
    data: {
      userId,
      provider: started.provider,
      isMock: started.isMock,
      status: "PENDING",
      tokenHash: sha256(started.token),
      expiresAt: started.expiresAt,
    },
  });
  return { token: started.token };
}

/**
 * Completing verification is what makes someone eligible for the connection
 * pool. With the mock provider this is a demo gate, not identity proof.
 */
export async function completeVerification(token: string): Promise<{ userId: string }> {
  const verification = await prisma.verification.findUnique({
    where: { tokenHash: sha256(token) },
  });
  if (!verification) throw new DomainError("Verification not found", "NOT_FOUND", 404);
  if (verification.status !== "PENDING") {
    throw new DomainError("Verification already used", "CONFLICT", 409);
  }
  if (verification.expiresAt && verification.expiresAt < new Date()) {
    await prisma.verification.update({
      where: { id: verification.id },
      data: { status: "EXPIRED" },
    });
    throw new DomainError("Verification expired", "EXPIRED", 410);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.verification.update({
      where: { id: verification.id },
      data: { status: "PASSED", completedAt: now, tokenHash: null },
    }),
    prisma.user.update({
      where: { id: verification.userId },
      data: { verifiedAt: now, poolEligibleAt: now },
    }),
  ]);
  return { userId: verification.userId };
}

export async function isPoolEligible(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return Boolean(user?.poolEligibleAt);
}
