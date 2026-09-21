import type { Connection, Prisma, VideoSession } from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import { generateToken, sha256 } from "@/modules/shared/crypto";
import { AuthorizationError, DomainError } from "@/modules/shared/errors";
import { videoProvider } from "@/modules/providers/video";
import { recordLearningEvent } from "@/modules/learning/service";
import { enqueueOutbound } from "@/modules/messaging/outbox";

export const VIDEO_DURATION_MINUTES = 20;
/** The link dies shortly after the call it was issued for. */
const GRANT_VALID_AFTER_START_MS = 2 * 60 * 60 * 1000;

export interface TimeSlot {
  startAt: Date;
  endAt: Date;
}

export async function connectionFor(userId: string, connectionId: string): Promise<Connection> {
  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new DomainError("Connection not found", "NOT_FOUND", 404);
  if (connection.userAId !== userId && connection.userBId !== userId) {
    throw new AuthorizationError();
  }
  return connection;
}

export function counterpartId(connection: Connection, userId: string): string {
  return connection.userAId === userId ? connection.userBId : connection.userAId;
}

/** The connection the Agent is currently coordinating for this user, if any. */
export async function activeConnection(userId: string): Promise<Connection | null> {
  return prisma.connection.findFirst({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { in: ["MUTUAL_INTEREST", "VIDEO_SCHEDULED", "VIDEO_COMPLETED"] },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Three evening windows over the coming days, anchored to the user's own
 * timezone so the times the Agent offers are the times they actually read.
 */
export function defaultSlots(timezone: string, from: Date = new Date()): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let day = 1; day <= 3; day += 1) {
    const startAt = atLocalHour(from, day, 20, timezone);
    slots.push({
      startAt,
      endAt: new Date(startAt.getTime() + VIDEO_DURATION_MINUTES * 60_000),
    });
  }
  return slots;
}

/** The instant of `hour` local time in `timezone`, `daysAhead` days from `from`. */
function atLocalHour(from: Date, daysAhead: number, hour: number, timezone: string): Date {
  const target = new Date(from.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const guess = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), hour, 0, 0, 0),
  );
  const offsetMs = timezoneOffsetMs(guess, timezone);
  return new Date(guess.getTime() - offsetMs);
}

function timezoneOffsetMs(instant: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

export function formatSlot(slot: TimeSlot, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(slot.startAt);
}

export function userTimezone(timezone: string | null): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/**
 * Each side gives its own availability; nobody sees the other's calendar.
 * Re-sending the same windows is harmless.
 */
export async function shareAvailability(params: {
  userId: string;
  connectionId: string;
  slots: TimeSlot[];
}): Promise<{ stored: number }> {
  const connection = await connectionFor(params.userId, params.connectionId);
  if (connection.status === "CONTACT_EXCHANGED" || connection.status === "CLOSED") {
    throw new DomainError("This connection is no longer being coordinated", "CONFLICT", 409);
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId } });
  const timezone = userTimezone(user.timezone);

  let stored = 0;
  await prisma.$transaction(async (tx) => {
    for (const slot of params.slots) {
      if (slot.endAt <= slot.startAt) {
        throw new DomainError("A window has to end after it starts", "INVALID", 400);
      }
      const existing = await tx.availability.findFirst({
        where: {
          userId: params.userId,
          connectionId: params.connectionId,
          startAt: slot.startAt,
          endAt: slot.endAt,
        },
      });
      if (existing) continue;
      await tx.availability.create({
        data: {
          userId: params.userId,
          connectionId: params.connectionId,
          startAt: slot.startAt,
          endAt: slot.endAt,
          timezone,
        },
      });
      stored += 1;
    }
    await simulateDemoAvailability(tx, connection, params.userId, params.slots);
  });
  return { stored };
}

/**
 * A demo profile has nobody behind it, so its calendar is derived from the
 * real user's proposal — deterministically, and only for demo profiles.
 */
async function simulateDemoAvailability(
  tx: Prisma.TransactionClient,
  connection: Connection,
  userId: string,
  slots: TimeSlot[],
): Promise<void> {
  const otherId = counterpartId(connection, userId);
  const other = await tx.user.findUnique({ where: { id: otherId } });
  if (!other?.isDemo) return;
  const accepted = slots.filter((_, index) => index % 2 === 0);
  for (const slot of accepted) {
    const existing = await tx.availability.findFirst({
      where: {
        userId: otherId,
        connectionId: connection.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
      },
    });
    if (existing) continue;
    await tx.availability.create({
      data: {
        userId: otherId,
        connectionId: connection.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        timezone: userTimezone(other.timezone),
      },
    });
  }
}

/** Windows both sides can actually make, long enough for the call. */
export async function overlappingSlots(connectionId: string): Promise<TimeSlot[]> {
  const connection = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
  const [mine, theirs] = await Promise.all([
    prisma.availability.findMany({
      where: { connectionId, userId: connection.userAId },
      orderBy: { startAt: "asc" },
    }),
    prisma.availability.findMany({
      where: { connectionId, userId: connection.userBId },
      orderBy: { startAt: "asc" },
    }),
  ]);

  const overlaps: TimeSlot[] = [];
  for (const a of mine) {
    for (const b of theirs) {
      const startAt = a.startAt > b.startAt ? a.startAt : b.startAt;
      const endAt = a.endAt < b.endAt ? a.endAt : b.endAt;
      if (endAt.getTime() - startAt.getTime() >= VIDEO_DURATION_MINUTES * 60_000) {
        overlaps.push({ startAt, endAt });
      }
    }
  }
  return overlaps
    .sort((x, y) => x.startAt.getTime() - y.startAt.getTime())
    .filter(
      (slot, index, all) =>
        index === 0 || slot.startAt.getTime() !== all[index - 1].startAt.getTime(),
    );
}

export interface ScheduledVideo {
  session: VideoSession;
  slot: TimeSlot;
  /** Shown once to the requesting user; only its hash is stored. */
  token: string;
}

/**
 * Books the single 20-minute call. Each side gets its own link, bound to that
 * person and to this session.
 */
export async function scheduleVideo(params: {
  userId: string;
  connectionId: string;
  slotIndex: number;
}): Promise<ScheduledVideo> {
  const connection = await connectionFor(params.userId, params.connectionId);
  const existing = await prisma.videoSession.findFirst({
    where: { connectionId: connection.id, status: { in: ["SCHEDULED", "ACTIVE"] } },
  });
  if (existing) {
    const token = await issueGrant(existing.id, params.userId, existing.scheduledAt);
    return {
      session: existing,
      slot: {
        startAt: existing.scheduledAt,
        endAt: new Date(existing.scheduledAt.getTime() + existing.durationMins * 60_000),
      },
      token,
    };
  }

  const overlaps = await overlappingSlots(connection.id);
  const slot = overlaps[params.slotIndex];
  if (!slot) throw new DomainError("That time isn't one you both have free", "INVALID", 400);

  const provider = videoProvider();
  const session = await prisma.videoSession.create({
    data: {
      connectionId: connection.id,
      provider: provider.name,
      scheduledAt: slot.startAt,
      durationMins: VIDEO_DURATION_MINUTES,
      status: "SCHEDULED",
    },
  });
  await provider.createRoom(session.id);
  await prisma.connection.update({
    where: { id: connection.id },
    data: { status: "VIDEO_SCHEDULED" },
  });

  const token = await issueGrant(session.id, params.userId, session.scheduledAt);
  await issueGrant(session.id, counterpartId(connection, params.userId), session.scheduledAt);

  await prisma.$transaction(async (tx) => {
    await recordLearningEvent(tx, {
      userId: params.userId,
      candidateUserId: counterpartId(connection, params.userId),
      connectionId: connection.id,
      sourceEventId: `video-accepted:${session.id}:${params.userId}`,
      eventType: "VIDEO_ACCEPTED",
      signalDirection: "POSITIVE",
      stage: "VIDEO",
      evidenceGroupKey: `${params.userId}:${counterpartId(connection, params.userId)}`,
    });
  });

  return { session, slot, token };
}

/** Issuing a link again replaces the previous one rather than adding a second. */
async function issueGrant(
  videoSessionId: string,
  userId: string,
  scheduledAt: Date,
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(scheduledAt.getTime() + GRANT_VALID_AFTER_START_MS);
  await prisma.videoAccessGrant.upsert({
    where: { videoSessionId_userId: { videoSessionId, userId } },
    update: { tokenHash: sha256(token), expiresAt, revokedAt: null, redeemedAt: null },
    create: { videoSessionId, userId, tokenHash: sha256(token), expiresAt },
  });
  return token;
}

export interface VideoRoomView {
  sessionId: string;
  userId: string;
  scheduledAt: Date;
  durationMins: number;
  counterpartName: string;
  isMock: true;
}

/**
 * Redeems a link. The token is looked up by hash, and an expired, revoked or
 * finished session is refused — the database id is never part of the URL.
 */
export async function redeemVideoToken(token: string): Promise<VideoRoomView> {
  const grant = await prisma.videoAccessGrant.findUnique({
    where: { tokenHash: sha256(token) },
    include: { videoSession: { include: { connection: true } } },
  });
  if (!grant) throw new DomainError("This link isn't valid", "NOT_FOUND", 404);
  if (grant.revokedAt) throw new DomainError("This link was revoked", "FORBIDDEN", 403);
  if (grant.expiresAt < new Date()) throw new DomainError("This link has expired", "EXPIRED", 410);
  const session = grant.videoSession;
  if (session.status === "CANCELLED") {
    throw new DomainError("This call was cancelled", "CONFLICT", 409);
  }

  const otherId = counterpartId(session.connection, grant.userId);
  const other = await prisma.user.findUnique({ where: { id: otherId } });

  await prisma.$transaction([
    prisma.videoAccessGrant.update({
      where: { id: grant.id },
      data: { redeemedAt: grant.redeemedAt ?? new Date() },
    }),
    ...(session.status === "SCHEDULED"
      ? [
          prisma.videoSession.update({
            where: { id: session.id },
            data: { status: "ACTIVE" },
          }),
        ]
      : []),
  ]);

  return {
    sessionId: session.id,
    userId: grant.userId,
    scheduledAt: session.scheduledAt,
    durationMins: session.durationMins,
    counterpartName: other?.displayName ?? "Your match",
    isMock: true,
  };
}

export async function revokeGrant(videoSessionId: string, userId: string): Promise<void> {
  await prisma.videoAccessGrant.updateMany({
    where: { videoSessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export const FEEDBACK_PROMPT = [
  "That's the 20 minutes. Three quick things, and none of it goes to them:",
  "Would you still like to get to know them? (yes / maybe / no)",
  "How did the conversation feel \u2014 natural, neutral, or uncomfortable?",
  "And should I keep looking for other people in the meantime?",
].join("\n\n");

/** Each side is asked on its own thread; nobody answers in front of the other. */
async function askForFeedback(
  tx: Prisma.TransactionClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.isDemo) return;
  const conversation = await tx.conversation.findFirst({
    where: { userId },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!conversation) return;
  await enqueueOutbound(tx, {
    conversationId: conversation.id,
    text: FEEDBACK_PROMPT,
    dedupeKey: `video-feedback-prompt:${sessionId}:${userId}`,
  });
}

/** Leaving the room ends the call for both sides and opens the feedback step. */
export async function completeVideo(sessionId: string): Promise<void> {
  const session = await prisma.videoSession.findUnique({
    where: { id: sessionId },
    include: { connection: true },
  });
  if (!session) throw new DomainError("Session not found", "NOT_FOUND", 404);
  if (session.status === "COMPLETED") return;

  await prisma.$transaction(async (tx) => {
    await tx.videoSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await tx.connection.update({
      where: { id: session.connectionId },
      data: { status: "VIDEO_COMPLETED" },
    });
    await tx.videoAccessGrant.updateMany({
      where: { videoSessionId: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Completing a call says the meeting happened. It does not say either
    // person liked the other, so it is recorded as neutral.
    for (const userId of [session.connection.userAId, session.connection.userBId]) {
      await recordLearningEvent(tx, {
        userId,
        candidateUserId: counterpartId(session.connection, userId),
        connectionId: session.connectionId,
        sourceEventId: `video-completed:${session.id}:${userId}`,
        eventType: "VIDEO_COMPLETED",
        signalDirection: "NEUTRAL",
        stage: "VIDEO",
        evidenceGroupKey: `${userId}:${counterpartId(session.connection, userId)}`,
      });
      await askForFeedback(tx, session.id, userId);
    }
  });
}

export async function currentVideoSession(connectionId: string): Promise<VideoSession | null> {
  return prisma.videoSession.findFirst({
    where: { connectionId },
    orderBy: { createdAt: "desc" },
  });
}
