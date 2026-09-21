import type { Prisma, Recommendation } from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import { env } from "@/config/env";
import { DomainError } from "@/modules/shared/errors";
import { rankableLearnedPreferences, recordLearningEvent } from "@/modules/learning/service";
import { passesHardFilters, type FilterSubject } from "./filters";
import { scorePair, SCORING_POLICY_VERSION, type ScoringSubject } from "./scoring";

type Subject = FilterSubject & ScoringSubject;

/** Loads only the matchable state: confirmed signals and stated hard filters. */
async function loadSubject(userId: string): Promise<Subject | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const [intent, hardFilters, signals, learned] = await Promise.all([
    prisma.connectionIntent.findFirst({
      where: { userId, endedAt: null },
      orderBy: { activeAt: "desc" },
    }),
    prisma.preference.findMany({
      where: { userId, isHardFilter: true, supersededAt: null },
    }),
    prisma.relationshipSignal.findMany({
      where: { userId, matchable: true, reviewStatus: "CONFIRMED", supersededAt: null },
    }),
    rankableLearnedPreferences(userId),
  ]);
  return { user, intent: intent?.intent ?? null, hardFilters, signals, learned };
}

async function loadCandidates(subject: Subject): Promise<Subject[]> {
  // A real user is only ever introduced to demo profiles when that is enabled,
  // and demo profiles are never the subject of a recommendation themselves.
  const allowDemo = env().MATCH_WITH_DEMO_USERS;
  const [excludedIds, candidates] = await Promise.all([
    excludedCandidateIds(subject.user.id),
    prisma.user.findMany({
      where: {
        id: { not: subject.user.id },
        status: "ACTIVE",
        poolEligibleAt: { not: null },
        ...(subject.user.isDemo ? { isDemo: true } : allowDemo ? {} : { isDemo: false }),
      },
      take: 200,
    }),
  ]);

  const usable = candidates.filter((c) => !excludedIds.has(c.id));
  const loaded = await Promise.all(usable.map((c) => loadSubject(c.id)));
  return loaded.filter((s): s is Subject => s !== null);
}

/** Blocks, people already recommended, and existing connections drop out. */
async function excludedCandidateIds(userId: string): Promise<Set<string>> {
  const [recommendations, interests, blocksMade, blocksReceived, connectionsA, connectionsB] =
    await Promise.all([
      prisma.recommendation.findMany({ where: { userId }, select: { candidateUserId: true } }),
      prisma.interest.findMany({ where: { userId }, select: { targetUserId: true } }),
      prisma.userBlock.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
      prisma.userBlock.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
      prisma.connection.findMany({ where: { userAId: userId }, select: { userBId: true } }),
      prisma.connection.findMany({ where: { userBId: userId }, select: { userAId: true } }),
    ]);
  return new Set([
    ...recommendations.map((r) => r.candidateUserId),
    ...interests.map((i) => i.targetUserId),
    ...blocksMade.map((b) => b.blockedId),
    ...blocksReceived.map((b) => b.blockerId),
    ...connectionsA.map((c) => c.userBId),
    ...connectionsB.map((c) => c.userAId),
  ]);
}

export type RecommendationOutcome =
  | { status: "NOT_ELIGIBLE"; reason: "PAUSED" | "UNVERIFIED" | "UNKNOWN_USER" }
  | { status: "ALREADY_PENDING"; recommendation: Recommendation }
  | { status: "NO_CANDIDATE" }
  | { status: "CREATED"; recommendation: Recommendation };

/**
 * One person at a time: a user never holds more than a single open
 * recommendation, so there is nothing to browse or compare.
 */
export async function nextRecommendation(userId: string): Promise<RecommendationOutcome> {
  const subject = await loadSubject(userId);
  if (!subject) return { status: "NOT_ELIGIBLE", reason: "UNKNOWN_USER" };
  if (subject.user.status !== "ACTIVE") return { status: "NOT_ELIGIBLE", reason: "PAUSED" };
  if (!subject.user.poolEligibleAt) return { status: "NOT_ELIGIBLE", reason: "UNVERIFIED" };

  const open = await openRecommendation(userId);
  if (open) return { status: "ALREADY_PENDING", recommendation: open };

  const candidates = await loadCandidates(subject);
  const scored = candidates
    .filter((c) => passesHardFilters(subject, c).passed)
    .map((c) => ({ candidate: c, ...scorePair(subject, c) }))
    // Ties break on id so the same pool always yields the same ordering.
    .sort((a, b) => b.score - a.score || a.candidate.user.id.localeCompare(b.candidate.user.id));

  const best = scored[0];
  if (!best) return { status: "NO_CANDIDATE" };

  const recommendation = await prisma.recommendation.create({
    data: {
      userId,
      candidateUserId: best.candidate.user.id,
      score: best.score,
      reason: best.reason,
      policyVersion: SCORING_POLICY_VERSION,
      exposureContext: {
        components: best.components,
        candidateIsDemo: best.candidate.user.isDemo,
        learnedPreferenceIds: best.learnedPreferenceIds,
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  return { status: "CREATED", recommendation };
}

/** The recommendation the user still owes an answer on, if any. */
export async function openRecommendation(userId: string): Promise<Recommendation | null> {
  const answered = await prisma.interest.findMany({
    where: { userId, state: { in: ["INTERESTED", "NOT_INTERESTED"] } },
    select: { recommendationId: true },
  });
  const answeredIds = answered.map((a) => a.recommendationId);
  return prisma.recommendation.findFirst({
    where: {
      userId,
      id: { notIn: answeredIds.length ? answeredIds : ["__none__"] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Introduction copy: a person, a reason, and no score or ranking. */
export async function introductionText(recommendation: Recommendation): Promise<string> {
  const candidate = await prisma.user.findUnique({
    where: { id: recommendation.candidateUserId },
  });
  if (!candidate) throw new DomainError("Candidate missing", "NOT_FOUND", 404);
  const name = candidate.displayName ?? "Someone";
  const where = candidate.city ? ` in ${candidate.city}` : "";
  const age = candidate.ageYears ? `, ${candidate.ageYears}` : "";
  const demoNote = candidate.isDemo ? "\n\n(Demo profile — not a real person.)" : "";
  return [
    `There's someone I think is worth knowing: ${name}${age}${where}.`,
    candidate.bio ?? "",
    `Why I'm introducing you: ${recommendation.reason}.`,
    "Want me to see if they're interested too? Just tell me yes, not now, or no.",
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat(demoNote);
}

export interface InterestOutcome {
  state: "INTERESTED" | "NOT_INTERESTED" | "LATER";
  mutual: boolean;
  connectionId?: string;
}

/**
 * Records one side's answer. A connection only exists once both sides said
 * yes; "later" and silence stay neutral and never count as a rejection.
 */
export async function respondToRecommendation(params: {
  userId: string;
  recommendationId: string;
  state: "INTERESTED" | "NOT_INTERESTED" | "LATER";
  privateReason?: string;
}): Promise<InterestOutcome> {
  const recommendation = await prisma.recommendation.findUnique({
    where: { id: params.recommendationId },
  });
  if (!recommendation) throw new DomainError("Recommendation not found", "NOT_FOUND", 404);
  if (recommendation.userId !== params.userId) {
    throw new DomainError("Recommendation belongs to another user", "FORBIDDEN", 403);
  }

  return prisma.$transaction(async (tx) => {
    await tx.interest.upsert({
      where: {
        userId_targetUserId: {
          userId: params.userId,
          targetUserId: recommendation.candidateUserId,
        },
      },
      update: { state: params.state, privateReason: params.privateReason },
      create: {
        recommendationId: recommendation.id,
        userId: params.userId,
        targetUserId: recommendation.candidateUserId,
        state: params.state,
        privateReason: params.privateReason,
      },
    });

    // Behaviour is stored as evidence, never as a conclusion. "Later" stays
    // neutral on purpose: not answering yet says nothing about the person shown.
    await recordLearningEvent(tx, {
      userId: params.userId,
      candidateUserId: recommendation.candidateUserId,
      recommendationId: recommendation.id,
      sourceEventId: `interest:${recommendation.id}:${params.state}`,
      eventType: params.state,
      signalDirection:
        params.state === "INTERESTED"
          ? "POSITIVE"
          : params.state === "NOT_INTERESTED"
            ? "NEGATIVE"
            : "NEUTRAL",
      stage: "RECOMMENDATION",
      explicitFeedback: params.privateReason,
      evidenceGroupKey: `${params.userId}:${recommendation.candidateUserId}`,
    });

    if (params.state !== "INTERESTED") {
      return { state: params.state, mutual: false };
    }

    await simulateDemoAnswer(tx, recommendation.candidateUserId, params.userId, recommendation.score);

    const reciprocal = await tx.interest.findUnique({
      where: {
        userId_targetUserId: {
          userId: recommendation.candidateUserId,
          targetUserId: params.userId,
        },
      },
    });
    if (reciprocal?.state !== "INTERESTED") {
      return { state: params.state, mutual: false };
    }

    const [userAId, userBId] = [params.userId, recommendation.candidateUserId].sort();
    const connection = await tx.connection.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: {},
      create: { userAId, userBId, status: "MUTUAL_INTEREST" },
    });
    return { state: params.state, mutual: true, connectionId: connection.id };
  });
}

/**
 * Demo profiles have nobody behind them, so their side of the mutual-interest
 * step is simulated deterministically from the same score. Real users are
 * never answered on their behalf.
 */
async function simulateDemoAnswer(
  tx: Prisma.TransactionClient,
  demoUserId: string,
  targetUserId: string,
  score: number,
): Promise<void> {
  const demo = await tx.user.findUnique({ where: { id: demoUserId } });
  if (!demo?.isDemo) return;

  const existing = await tx.interest.findUnique({
    where: { userId_targetUserId: { userId: demoUserId, targetUserId } },
  });
  if (existing) return;

  const mirror = await tx.recommendation.upsert({
    where: { userId_candidateUserId: { userId: demoUserId, candidateUserId: targetUserId } },
    update: {},
    create: {
      userId: demoUserId,
      candidateUserId: targetUserId,
      score,
      reason: "simulated demo consideration",
      policyVersion: SCORING_POLICY_VERSION,
      exposureContext: { simulated: true },
    },
  });
  await tx.interest.create({
    data: {
      recommendationId: mirror.id,
      userId: demoUserId,
      targetUserId,
      state: score >= 0.5 ? "INTERESTED" : "NOT_INTERESTED",
    },
  });
}
