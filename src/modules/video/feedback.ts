import type { ComfortAnswer, ContinueAnswer, Prisma } from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import { AuthorizationError, DomainError } from "@/modules/shared/errors";
import { recordLearningEvent } from "@/modules/learning/service";
import { counterpartId } from "./service";

export interface FeedbackInput {
  userId: string;
  videoSessionId: string;
  wantContinue: ContinueAnswer;
  comfort: ComfortAnswer;
  keepSearching: boolean;
  note?: string;
}

export interface FeedbackOutcome {
  alreadySubmitted: boolean;
  bothAnswered: boolean;
  /** True only when both sides said yes; never says who said what. */
  mutualContinue: boolean;
}

/**
 * Each side answers privately. The other person is never told what was said,
 * only — once both have answered yes — that there is a next step.
 */
export async function submitVideoFeedback(input: FeedbackInput): Promise<FeedbackOutcome> {
  const session = await prisma.videoSession.findUnique({
    where: { id: input.videoSessionId },
    include: { connection: true },
  });
  if (!session) throw new DomainError("Session not found", "NOT_FOUND", 404);
  const { connection } = session;
  if (connection.userAId !== input.userId && connection.userBId !== input.userId) {
    throw new AuthorizationError();
  }
  if (session.status !== "COMPLETED") {
    throw new DomainError("The call hasn't finished yet", "CONFLICT", 409);
  }

  const existing = await prisma.videoFeedback.findUnique({
    where: { videoSessionId_userId: { videoSessionId: session.id, userId: input.userId } },
  });
  if (existing) {
    const state = await continueState(session.id, connection.userAId, connection.userBId);
    return { alreadySubmitted: true, ...state };
  }

  const otherId = counterpartId(connection, input.userId);
  await prisma.$transaction(async (tx) => {
    await tx.videoFeedback.create({
      data: {
        videoSessionId: session.id,
        userId: input.userId,
        wantContinue: input.wantContinue,
        comfort: input.comfort,
        keepSearching: input.keepSearching,
        note: input.note,
      },
    });

    await recordLearningEvent(tx, {
      userId: input.userId,
      candidateUserId: otherId,
      connectionId: connection.id,
      sourceEventId: `post-video:${session.id}:${input.userId}`,
      eventType:
        input.wantContinue === "YES"
          ? "WANT_TO_CONTINUE"
          : input.wantContinue === "NO"
            ? "NOT_INTERESTED"
            : "LATER",
      signalDirection:
        input.wantContinue === "YES"
          ? "POSITIVE"
          : input.wantContinue === "NO"
            ? "NEGATIVE"
            : "NEUTRAL",
      stage: "POST_VIDEO",
      explicitFeedback: input.note,
      evidenceGroupKey: `${input.userId}:${otherId}`,
    });

    if (input.comfort === "UNCOMFORTABLE") {
      // Discomfort is a safety matter first. It is queued for a human to look
      // at rather than quietly folded into ranking.
      await tx.safetyReport.create({
        data: {
          reporterId: input.userId,
          reportedUserId: otherId,
          category: "post_video_discomfort",
          detail: input.note,
        },
      });
    }

    if (!input.keepSearching) {
      await tx.user.update({
        where: { id: input.userId },
        data: { status: "PAUSED", connectionsPausedAt: new Date() },
      });
    }

    await simulateDemoFeedback(tx, session.id, otherId, input.userId);
  });

  const state = await continueState(session.id, connection.userAId, connection.userBId);
  return { alreadySubmitted: false, ...state };
}

async function continueState(
  videoSessionId: string,
  userAId: string,
  userBId: string,
): Promise<{ bothAnswered: boolean; mutualContinue: boolean }> {
  const rows = await prisma.videoFeedback.findMany({ where: { videoSessionId } });
  const a = rows.find((r) => r.userId === userAId);
  const b = rows.find((r) => r.userId === userBId);
  const bothAnswered = Boolean(a && b);
  return {
    bothAnswered,
    mutualContinue: bothAnswered && a?.wantContinue === "YES" && b?.wantContinue === "YES",
  };
}

/** Demo profiles answer deterministically; a real person is never answered for. */
async function simulateDemoFeedback(
  tx: Prisma.TransactionClient,
  videoSessionId: string,
  otherId: string,
  realUserId: string,
): Promise<void> {
  const other = await tx.user.findUnique({ where: { id: otherId } });
  if (!other?.isDemo) return;
  const existing = await tx.videoFeedback.findUnique({
    where: { videoSessionId_userId: { videoSessionId, userId: otherId } },
  });
  if (existing) return;
  await tx.videoFeedback.create({
    data: {
      videoSessionId,
      userId: otherId,
      wantContinue: "YES",
      comfort: "NATURAL",
      keepSearching: true,
      note: "simulated demo feedback",
    },
  });
  await recordLearningEvent(tx, {
    userId: otherId,
    candidateUserId: realUserId,
    sourceEventId: `post-video:${videoSessionId}:${otherId}`,
    eventType: "WANT_TO_CONTINUE",
    signalDirection: "POSITIVE",
    stage: "POST_VIDEO",
    evidenceGroupKey: `${otherId}:${realUserId}`,
  });
}

/** What this user answered. Only ever their own row. */
export async function myFeedback(userId: string, videoSessionId: string) {
  return prisma.videoFeedback.findUnique({
    where: { videoSessionId_userId: { videoSessionId, userId } },
  });
}
