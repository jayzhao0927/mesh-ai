import type {
  LearnedPreference,
  LearningEventType,
  LearningStage,
  Prisma,
  PreferenceLearningEvent,
  SignalDirection,
} from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import { AuthorizationError, DomainError } from "@/modules/shared/errors";
import {
  INDEPENDENT_EVIDENCE_TARGET,
  LEARNING_POLICY_VERSION,
  SOFT_RANKING_THRESHOLD,
  STAGE_WEIGHTS,
} from "./policy";

export interface CandidateAttributeSnapshot {
  city: string | null;
  ageYears: number | null;
  languages: string[];
  interests: string[];
}

/**
 * The candidate as they were when the user reacted. Later profile edits must
 * not rewrite the evidence behind a hypothesis.
 */
export async function candidateSnapshot(
  tx: Prisma.TransactionClient,
  candidateUserId: string,
): Promise<CandidateAttributeSnapshot | null> {
  const [candidate, signals] = await Promise.all([
    tx.user.findUnique({ where: { id: candidateUserId } }),
    tx.relationshipSignal.findMany({
      where: {
        userId: candidateUserId,
        category: "interest",
        matchable: true,
        reviewStatus: "CONFIRMED",
        supersededAt: null,
      },
    }),
  ]);
  if (!candidate) return null;
  return {
    city: candidate.city,
    ageYears: candidate.ageYears,
    languages: candidate.languages,
    interests: [...new Set(signals.map((s) => s.value.trim().toLowerCase()))].sort(),
  };
}

export interface LearningEventInput {
  userId: string;
  candidateUserId?: string;
  recommendationId?: string;
  connectionId?: string;
  /** Stable identity of the underlying event, so redelivery cannot count twice. */
  sourceEventId: string;
  eventType: LearningEventType;
  signalDirection: SignalDirection;
  stage: LearningStage;
  explicitFeedback?: string;
  /** Everything from one connection groups together — it is one sample, not many. */
  evidenceGroupKey: string;
  occurredAt?: Date;
}

/**
 * Stores what happened as evidence and folds it into the affected hypotheses.
 * Nothing here concludes anything on its own: a single reaction only moves a
 * confidence, and a neutral reaction moves nothing at all.
 */
export async function recordLearningEvent(
  tx: Prisma.TransactionClient,
  input: LearningEventInput,
): Promise<PreferenceLearningEvent | null> {
  const existing = await tx.preferenceLearningEvent.findUnique({
    where: { sourceEventId: input.sourceEventId },
  });
  if (existing) return existing;

  const snapshot = input.candidateUserId
    ? await candidateSnapshot(tx, input.candidateUserId)
    : null;
  const weight = input.signalDirection === "NEUTRAL" ? 0 : STAGE_WEIGHTS[input.stage];

  const event = await tx.preferenceLearningEvent.create({
    data: {
      userId: input.userId,
      candidateUserId: input.candidateUserId,
      recommendationId: input.recommendationId,
      connectionId: input.connectionId,
      sourceEventId: input.sourceEventId,
      eventType: input.eventType,
      signalDirection: input.signalDirection,
      stage: input.stage,
      explicitFeedback: input.explicitFeedback,
      candidateAttributeSnapshot: snapshot
        ? (snapshot as unknown as Prisma.InputJsonValue)
        : undefined,
      exposureContext: {
        stageWeight: weight,
        hadExplicitFeedback: Boolean(input.explicitFeedback),
      },
      evidenceGroupKey: input.evidenceGroupKey,
      confidence: 0.3,
      weight,
      policyVersion: LEARNING_POLICY_VERSION,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });

  if (weight > 0 && snapshot) {
    await aggregate(tx, event, snapshot);
  }
  return event;
}

interface DerivedAttribute {
  category: string;
  key: string;
  value: string;
}

/**
 * The attributes a reaction could plausibly be about. It is deliberately
 * coarse: we do not pretend to know which one actually mattered, we only
 * accumulate across people until a pattern survives.
 */
function derivedAttributes(snapshot: CandidateAttributeSnapshot): DerivedAttribute[] {
  const attributes: DerivedAttribute[] = [];
  for (const interest of snapshot.interests) {
    attributes.push({ category: "interest", key: "topic", value: interest });
  }
  if (snapshot.city) {
    attributes.push({ category: "context", key: "same_city_candidate", value: snapshot.city });
  }
  if (snapshot.ageYears != null) {
    const band = Math.floor(snapshot.ageYears / 5) * 5;
    attributes.push({ category: "context", key: "age_band", value: `${band}-${band + 4}` });
  }
  return attributes;
}

async function aggregate(
  tx: Prisma.TransactionClient,
  event: PreferenceLearningEvent,
  snapshot: CandidateAttributeSnapshot,
): Promise<void> {
  const supports = event.signalDirection === "POSITIVE";
  for (const attribute of derivedAttributes(snapshot)) {
    const hypothesis = await tx.learnedPreference.upsert({
      where: {
        userId_category_key_value: {
          userId: event.userId,
          category: attribute.category,
          key: attribute.key,
          value: attribute.value,
        },
      },
      update: {},
      create: {
        userId: event.userId,
        category: attribute.category,
        key: attribute.key,
        value: attribute.value,
        source: "BEHAVIORAL",
        status: "OBSERVING",
        policyVersion: LEARNING_POLICY_VERSION,
      },
    });

    // One connection is one sample: every stage of it collapses onto a single
    // evidence row per hypothesis, and a redelivered event finds it taken.
    await tx.preferenceEvidence.upsert({
      where: {
        learnedPreferenceId_dedupeKey: {
          learnedPreferenceId: hypothesis.id,
          dedupeKey: `${event.evidenceGroupKey}:${event.stage}`,
        },
      },
      update: {},
      create: {
        learnedPreferenceId: hypothesis.id,
        learningEventId: event.id,
        supports,
        rationale: `${event.eventType} at ${event.stage} with a candidate matching ${attribute.key}=${attribute.value}`,
        contribution: event.weight,
        dedupeKey: `${event.evidenceGroupKey}:${event.stage}`,
      },
    });

    await recompute(tx, hypothesis.id);
  }
}

/**
 * Recomputes a hypothesis from its surviving evidence. A hypothesis the user
 * rejected keeps collecting evidence but never silently comes back to life.
 */
export async function recompute(
  tx: Prisma.TransactionClient,
  learnedPreferenceId: string,
): Promise<LearnedPreference> {
  const hypothesis = await tx.learnedPreference.findUniqueOrThrow({
    where: { id: learnedPreferenceId },
  });
  const evidence = await tx.preferenceEvidence.findMany({
    where: { learnedPreferenceId, learningEvent: { invalidatedAt: null } },
    include: { learningEvent: true },
  });

  let support = 0;
  let oppose = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  const groups = new Set<string>();
  for (const row of evidence) {
    groups.add(row.learningEvent.evidenceGroupKey);
    if (row.supports) {
      support += row.contribution;
      positiveCount += 1;
    } else {
      oppose += row.contribution;
      negativeCount += 1;
    }
  }

  const independent = groups.size;
  const net = (support - oppose) / (support + oppose + 2);
  const breadth = Math.min(1, independent / INDEPENDENT_EVIDENCE_TARGET);
  const confidence =
    hypothesis.status === "REJECTED" ? 0 : Math.max(0, Number((net * breadth).toFixed(4)));

  return tx.learnedPreference.update({
    where: { id: learnedPreferenceId },
    data: {
      confidence,
      positiveEvidenceCount: positiveCount,
      negativeEvidenceCount: negativeCount,
      independentEvidenceCount: independent,
      version: { increment: 1 },
    },
  });
}

/**
 * The hypotheses allowed to influence ranking: confirmed by the user, or
 * observed often enough across separate people to be worth a nudge. A
 * rejected one is never in here.
 */
export async function rankableLearnedPreferences(
  userId: string,
): Promise<LearnedPreference[]> {
  const rows = await prisma.learnedPreference.findMany({
    where: { userId, status: { in: ["OBSERVING", "CONFIRMED"] } },
  });
  return rows.filter(
    (r) => r.status === "CONFIRMED" || r.confidence >= SOFT_RANKING_THRESHOLD,
  );
}

export async function listHypotheses(userId: string): Promise<LearnedPreference[]> {
  return prisma.learnedPreference.findMany({
    where: { userId, status: { not: "SUPERSEDED" } },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    take: 20,
  });
}

export type CorrectionKind = "CONFIRM" | "REJECT" | "UNSURE";

/**
 * The user has the final say. A correction is stored, applied to the
 * hypothesis, and invalidates anything derived from it — it is not an apology
 * in the chat while the backend keeps using the old conclusion.
 */
export async function correctHypothesis(params: {
  userId: string;
  learnedPreferenceId: string;
  correction: CorrectionKind;
  note?: string;
  /** Makes a retried message harmless. */
  idempotencyKey: string;
}): Promise<{ hypothesis: LearnedPreference; alreadyApplied: boolean }> {
  const hypothesis = await prisma.learnedPreference.findUnique({
    where: { id: params.learnedPreferenceId },
  });
  if (!hypothesis) throw new DomainError("Hypothesis not found", "NOT_FOUND", 404);
  if (hypothesis.userId !== params.userId) throw new AuthorizationError();

  const existing = await prisma.preferenceCorrection.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });
  if (existing) return { hypothesis, alreadyApplied: true };

  const status =
    params.correction === "CONFIRM"
      ? "CONFIRMED"
      : params.correction === "REJECT"
        ? "REJECTED"
        : "UNSURE";
  const confidenceAfter =
    params.correction === "CONFIRM" ? 1 : params.correction === "REJECT" ? 0 : Math.min(hypothesis.confidence, 0.2);

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.learnedPreference.update({
      where: { id: hypothesis.id },
      data: {
        status,
        confidence: confidenceAfter,
        source: "USER_STATED",
        version: { increment: 1 },
      },
    });
    await tx.preferenceCorrection.create({
      data: {
        userId: params.userId,
        learnedPreferenceId: hypothesis.id,
        correction: params.correction,
        note: params.note,
        confidenceBefore: hypothesis.confidence,
        confidenceAfter,
        targetVersion: hypothesis.version,
        idempotencyKey: params.idempotencyKey,
      },
    });
    await tx.preferenceLearningEvent.create({
      data: {
        userId: params.userId,
        sourceEventId: `correction:${params.idempotencyKey}`,
        eventType: "USER_CORRECTION",
        signalDirection: params.correction === "CONFIRM" ? "POSITIVE" : "NEUTRAL",
        stage: "RECOMMENDATION",
        explicitFeedback: params.note,
        evidenceGroupKey: `correction:${hypothesis.id}`,
        confidence: 1,
        weight: 0,
        policyVersion: LEARNING_POLICY_VERSION,
        occurredAt: new Date(),
      },
    });
    if (params.correction !== "CONFIRM") {
      await invalidateDerivedRecommendations(tx, params.userId, hypothesis.id);
    }
    return next;
  });

  return { hypothesis: updated, alreadyApplied: false };
}

/**
 * An unanswered recommendation that leaned on a hypothesis the user just
 * corrected is withdrawn, so the next introduction is computed again.
 */
async function invalidateDerivedRecommendations(
  tx: Prisma.TransactionClient,
  userId: string,
  learnedPreferenceId: string,
): Promise<void> {
  const answered = await tx.interest.findMany({
    where: { userId, state: { in: ["INTERESTED", "NOT_INTERESTED"] } },
    select: { recommendationId: true },
  });
  const open = await tx.recommendation.findMany({
    where: {
      userId,
      id: { notIn: answered.map((a) => a.recommendationId).concat("__none__") },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  const affected = open.filter((r) => {
    const context = r.exposureContext as { learnedPreferenceIds?: unknown } | null;
    const ids = Array.isArray(context?.learnedPreferenceIds) ? context.learnedPreferenceIds : [];
    return ids.includes(learnedPreferenceId);
  });
  if (affected.length === 0) return;
  await tx.recommendation.updateMany({
    where: { id: { in: affected.map((r) => r.id) } },
    data: { expiresAt: new Date() },
  });
}
