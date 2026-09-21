import type { ContactMethod, ContactMethodKind } from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import { AuthorizationError, DomainError } from "@/modules/shared/errors";
import { recordLearningEvent } from "@/modules/learning/service";
import { connectionFor, counterpartId } from "@/modules/video/service";

/**
 * Stores a contact method under a version. Consent is bound to the version it
 * was given for, so editing a number later never rides on an old agreement.
 */
export async function setContactMethod(params: {
  userId: string;
  kind: ContactMethodKind;
  value: string;
}): Promise<ContactMethod> {
  const current = await prisma.contactMethod.findFirst({
    where: { userId: params.userId, kind: params.kind },
    orderBy: { version: "desc" },
  });
  if (current?.value === params.value) return current;
  return prisma.contactMethod.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      value: params.value,
      version: (current?.version ?? 0) + 1,
    },
  });
}

export async function contactMethodsOf(userId: string): Promise<ContactMethod[]> {
  return prisma.contactMethod.findMany({
    where: { userId },
    orderBy: [{ kind: "asc" }, { version: "desc" }],
  });
}

async function bothWantToContinue(connectionId: string): Promise<boolean> {
  const session = await prisma.videoSession.findFirst({
    where: { connectionId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    include: { feedback: true, connection: true },
  });
  if (!session) return false;
  const a = session.feedback.find((f) => f.userId === session.connection.userAId);
  const b = session.feedback.find((f) => f.userId === session.connection.userBId);
  return a?.wantContinue === "YES" && b?.wantContinue === "YES";
}

export interface ExchangeOutcome {
  status: "WAITING_FOR_THEM" | "EXCHANGED";
  /** Only ever the counterpart's details, and only after a real exchange. */
  counterpart?: { kind: ContactMethodKind; value: string; displayName: string };
}

/**
 * One side's consent. It names the connection, the method and the version of
 * that method — accepting the terms of service is not consent to hand a phone
 * number to another person.
 */
export async function grantContactExchange(params: {
  userId: string;
  connectionId: string;
  contactMethodId: string;
}): Promise<ExchangeOutcome> {
  const connection = await connectionFor(params.userId, params.connectionId);
  if (!(await bothWantToContinue(connection.id))) {
    throw new DomainError(
      "Contact details are only exchanged after you've both said you want to keep going",
      "CONFLICT",
      409,
    );
  }
  const method = await prisma.contactMethod.findUnique({ where: { id: params.contactMethodId } });
  if (!method) throw new DomainError("Contact method not found", "NOT_FOUND", 404);
  if (method.userId !== params.userId) throw new AuthorizationError();

  await prisma.contactExchangeConsent.upsert({
    where: { connectionId_userId: { connectionId: connection.id, userId: params.userId } },
    update: {
      contactMethodId: method.id,
      methodVersion: method.version,
      grantedAt: new Date(),
      revokedAt: null,
    },
    create: {
      connectionId: connection.id,
      userId: params.userId,
      contactMethodId: method.id,
      methodVersion: method.version,
    },
  });

  await simulateDemoConsent(connection.id, counterpartId(connection, params.userId));
  return executeIfReady(connection.id, params.userId);
}

export async function revokeContactExchange(params: {
  userId: string;
  connectionId: string;
}): Promise<void> {
  const connection = await connectionFor(params.userId, params.connectionId);
  await prisma.contactExchangeConsent.updateMany({
    where: { connectionId: connection.id, userId: params.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Declining is a choice about privacy or pace, not a verdict on the person. */
export async function declineContactExchange(params: {
  userId: string;
  connectionId: string;
}): Promise<void> {
  const connection = await connectionFor(params.userId, params.connectionId);
  await revokeContactExchange(params);
  await prisma.$transaction(async (tx) => {
    await recordLearningEvent(tx, {
      userId: params.userId,
      candidateUserId: counterpartId(connection, params.userId),
      connectionId: connection.id,
      sourceEventId: `contact-declined:${connection.id}:${params.userId}`,
      eventType: "CONTACT_DECLINED",
      signalDirection: "NEUTRAL",
      stage: "CONTACT_EXCHANGE",
      evidenceGroupKey: `${params.userId}:${counterpartId(connection, params.userId)}`,
    });
  });
}

/**
 * Runs the exchange only if, at this moment, both consents are live, still
 * point at the current version of each method, and both people are still
 * active and unblocked.
 */
export async function executeIfReady(
  connectionId: string,
  forUserId: string,
): Promise<ExchangeOutcome> {
  const connection = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
  const consents = await prisma.contactExchangeConsent.findMany({
    where: { connectionId, revokedAt: null },
    include: { contactMethod: true, user: true },
  });
  const mine = consents.find((c) => c.userId === forUserId);
  const theirs = consents.find((c) => c.userId === counterpartId(connection, forUserId));
  if (!mine || !theirs) return { status: "WAITING_FOR_THEM" };

  const stale = consents.some((c) => c.methodVersion !== c.contactMethod.version);
  if (stale) return { status: "WAITING_FOR_THEM" };
  if (!(await bothWantToContinue(connectionId))) return { status: "WAITING_FOR_THEM" };
  if (consents.some((c) => c.user.status === "SUSPENDED" || c.user.status === "DELETED")) {
    return { status: "WAITING_FOR_THEM" };
  }
  const blocked = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: connection.userAId, blockedId: connection.userBId },
        { blockerId: connection.userBId, blockedId: connection.userAId },
      ],
    },
  });
  if (blocked) return { status: "WAITING_FOR_THEM" };

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.contactExchangeConsent.updateMany({
      where: { connectionId, exchangedAt: null, revokedAt: null },
      data: { exchangedAt: now },
    });
    await tx.connection.update({
      where: { id: connectionId },
      data: { status: "CONTACT_EXCHANGED" },
    });
    for (const consent of consents) {
      await recordLearningEvent(tx, {
        userId: consent.userId,
        candidateUserId: counterpartId(connection, consent.userId),
        connectionId,
        sourceEventId: `contact-exchange:${connectionId}:${consent.userId}`,
        eventType: "CONTACT_EXCHANGE",
        signalDirection: "POSITIVE",
        stage: "CONTACT_EXCHANGE",
        evidenceGroupKey: `${consent.userId}:${counterpartId(connection, consent.userId)}`,
      });
    }
  });

  return {
    status: "EXCHANGED",
    counterpart: {
      kind: theirs.contactMethod.kind,
      value: theirs.contactMethod.value,
      displayName: theirs.user.displayName ?? "They",
    },
  };
}

/** A demo profile consents to the method it was seeded with, nothing more. */
async function simulateDemoConsent(connectionId: string, otherId: string): Promise<void> {
  const other = await prisma.user.findUnique({ where: { id: otherId } });
  if (!other?.isDemo) return;
  const existing = await prisma.contactExchangeConsent.findUnique({
    where: { connectionId_userId: { connectionId, userId: otherId } },
  });
  if (existing && !existing.revokedAt) return;
  const method = await setContactMethod({
    userId: otherId,
    kind: "WECHAT",
    value: `demo-wechat-${other.id.slice(-6)}`,
  });
  await prisma.contactExchangeConsent.upsert({
    where: { connectionId_userId: { connectionId, userId: otherId } },
    update: {
      contactMethodId: method.id,
      methodVersion: method.version,
      grantedAt: new Date(),
      revokedAt: null,
    },
    create: {
      connectionId,
      userId: otherId,
      contactMethodId: method.id,
      methodVersion: method.version,
    },
  });
}
