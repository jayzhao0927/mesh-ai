import { describe, expect, it } from "vitest";
import { prisma } from "@/modules/shared/db";
import {
  correctHypothesis,
  listHypotheses,
  rankableLearnedPreferences,
  recordLearningEvent,
} from "@/modules/learning/service";
import { nextRecommendation, respondToRecommendation } from "@/modules/matching/service";
import { passesHardFilters } from "@/modules/matching/filters";
import { completeVerification, startVerification } from "@/modules/verification/service";
import { runTool } from "@/modules/agent/tools";
import type { LearningStage, SignalDirection } from "@prisma/client";

async function person(name: string, interests: string[] = [], city = "上海", age = 30) {
  const user = await prisma.user.create({
    data: { displayName: name, ageYears: age, city, languages: ["zh"] },
  });
  const { token } = await startVerification(user.id);
  await completeVerification(token);
  await prisma.connectionIntent.create({ data: { userId: user.id, intent: "DATING" } });
  for (const value of interests) {
    await prisma.relationshipSignal.create({
      data: {
        userId: user.id,
        category: "interest",
        key: "topic",
        value,
        source: "USER_STATED",
        userConfirmed: true,
        matchable: true,
        reviewStatus: "CONFIRMED",
      },
    });
  }
  return user;
}

async function record(params: {
  userId: string;
  candidateUserId: string;
  direction: SignalDirection;
  stage?: LearningStage;
  sourceEventId: string;
}) {
  return prisma.$transaction((tx) =>
    recordLearningEvent(tx, {
      userId: params.userId,
      candidateUserId: params.candidateUserId,
      sourceEventId: params.sourceEventId,
      eventType: params.direction === "POSITIVE" ? "INTERESTED" : "NOT_INTERESTED",
      signalDirection: params.direction,
      stage: params.stage ?? "RECOMMENDATION",
      evidenceGroupKey: `${params.userId}:${params.candidateUserId}`,
    }),
  );
}

function climbing(rows: Awaited<ReturnType<typeof listHypotheses>>) {
  return rows.find((r) => r.key === "topic" && r.value === "climbing");
}

describe("preference learning", () => {
  it("counts a redelivered event once", async () => {
    const a = await person("A");
    const b = await person("B", ["climbing"]);

    await record({ userId: a.id, candidateUserId: b.id, direction: "POSITIVE", sourceEventId: "e1" });
    await record({ userId: a.id, candidateUserId: b.id, direction: "POSITIVE", sourceEventId: "e1" });

    expect(await prisma.preferenceLearningEvent.count({ where: { userId: a.id } })).toBe(1);
    const hypothesis = climbing(await listHypotheses(a.id));
    expect(hypothesis?.independentEvidenceCount).toBe(1);
    expect(hypothesis?.positiveEvidenceCount).toBe(1);
  });

  it("treats several moments in one connection as one sample", async () => {
    const a = await person("A");
    const b = await person("B", ["climbing"]);

    await record({ userId: a.id, candidateUserId: b.id, direction: "POSITIVE", sourceEventId: "i1" });
    await record({
      userId: a.id,
      candidateUserId: b.id,
      direction: "POSITIVE",
      stage: "VIDEO",
      sourceEventId: "v1",
    });
    await record({
      userId: a.id,
      candidateUserId: b.id,
      direction: "POSITIVE",
      stage: "POST_VIDEO",
      sourceEventId: "p1",
    });

    expect(climbing(await listHypotheses(a.id))?.independentEvidenceCount).toBe(1);
  });

  it("learns nothing from 'later'", async () => {
    const a = await person("A");
    const b = await person("B", ["climbing"]);
    await prisma.$transaction((tx) =>
      recordLearningEvent(tx, {
        userId: a.id,
        candidateUserId: b.id,
        sourceEventId: "later-1",
        eventType: "LATER",
        signalDirection: "NEUTRAL",
        stage: "RECOMMENDATION",
        evidenceGroupKey: `${a.id}:${b.id}`,
      }),
    );
    expect(await prisma.learnedPreference.count({ where: { userId: a.id } })).toBe(0);
  });

  it("does not turn one 'not for me' into a preference", async () => {
    const a = await person("A");
    const b = await person("B", ["climbing"]);
    await record({ userId: a.id, candidateUserId: b.id, direction: "NEGATIVE", sourceEventId: "n1" });

    expect(climbing(await listHypotheses(a.id))?.confidence).toBeLessThan(0.35);
    expect(await rankableLearnedPreferences(a.id)).toHaveLength(0);
  });

  it("only ranks on a pattern seen across separate people", async () => {
    const a = await person("A");
    const candidates = [
      await person("B", ["climbing"], "上海", 31),
      await person("C", ["climbing"], "北京", 41),
      await person("D", ["climbing"], "广州", 51),
    ];
    for (const [index, candidate] of candidates.entries()) {
      await record({
        userId: a.id,
        candidateUserId: candidate.id,
        direction: "POSITIVE",
        sourceEventId: `pos-${index}`,
      });
      expect(climbing(await listHypotheses(a.id))?.independentEvidenceCount).toBe(index + 1);
    }

    const rankable = await rankableLearnedPreferences(a.id);
    expect(rankable.map((r) => r.value)).toContain("climbing");
  });

  it("keeps a rejected hypothesis out of ranking, and new evidence does not revive it", async () => {
    const a = await person("A");
    const candidates = [
      await person("B", ["climbing"], "上海", 31),
      await person("C", ["climbing"], "北京", 41),
      await person("D", ["climbing"], "广州", 51),
    ];
    for (const [index, candidate] of candidates.entries()) {
      await record({
        userId: a.id,
        candidateUserId: candidate.id,
        direction: "POSITIVE",
        sourceEventId: `pos-${index}`,
      });
    }
    const hypothesis = climbing(await listHypotheses(a.id))!;
    await correctHypothesis({
      userId: a.id,
      learnedPreferenceId: hypothesis.id,
      correction: "REJECT",
      idempotencyKey: "k1",
    });

    const e = await person("E", ["climbing"], "成都", 61);
    await record({ userId: a.id, candidateUserId: e.id, direction: "POSITIVE", sourceEventId: "pos-4" });

    const after = await prisma.learnedPreference.findUniqueOrThrow({ where: { id: hypothesis.id } });
    expect(after.status).toBe("REJECTED");
    expect(after.confidence).toBe(0);
    expect((await rankableLearnedPreferences(a.id)).map((r) => r.id)).not.toContain(hypothesis.id);
  });

  it("applies a repeated correction once", async () => {
    const a = await person("A");
    const b = await person("B", ["climbing"]);
    await record({ userId: a.id, candidateUserId: b.id, direction: "POSITIVE", sourceEventId: "e1" });
    const hypothesis = climbing(await listHypotheses(a.id))!;

    const first = await correctHypothesis({
      userId: a.id,
      learnedPreferenceId: hypothesis.id,
      correction: "REJECT",
      idempotencyKey: "same-key",
    });
    const second = await correctHypothesis({
      userId: a.id,
      learnedPreferenceId: hypothesis.id,
      correction: "REJECT",
      idempotencyKey: "same-key",
    });

    expect(first.alreadyApplied).toBe(false);
    expect(second.alreadyApplied).toBe(true);
    expect(await prisma.preferenceCorrection.count({ where: { userId: a.id } })).toBe(1);
  });

  it("refuses to correct someone else's hypothesis", async () => {
    const a = await person("A");
    const b = await person("B", ["climbing"]);
    await record({ userId: a.id, candidateUserId: b.id, direction: "POSITIVE", sourceEventId: "e1" });
    const hypothesis = climbing(await listHypotheses(a.id))!;

    await expect(
      correctHypothesis({
        userId: b.id,
        learnedPreferenceId: hypothesis.id,
        correction: "CONFIRM",
        idempotencyKey: "other",
      }),
    ).rejects.toThrow(/Not authorized/);
  });

  it("withdraws an open recommendation that leaned on a corrected hypothesis", async () => {
    const a = await person("A");
    for (const [index, city] of ["上海", "北京", "广州"].entries()) {
      const candidate = await person(`seed-${index}`, ["climbing"], city, 31 + index * 10);
      await record({
        userId: a.id,
        candidateUserId: candidate.id,
        direction: "POSITIVE",
        sourceEventId: `pos-${index}`,
      });
    }
    await person("Fresh", ["climbing"], "上海", 30);

    const created = await nextRecommendation(a.id);
    if (created.status !== "CREATED") throw new Error("expected a recommendation");
    const context = created.recommendation.exposureContext as { learnedPreferenceIds: string[] };
    expect(context.learnedPreferenceIds.length).toBeGreaterThan(0);

    await correctHypothesis({
      userId: a.id,
      learnedPreferenceId: context.learnedPreferenceIds[0],
      correction: "REJECT",
      idempotencyKey: "reject-1",
    });

    const after = await prisma.recommendation.findUniqueOrThrow({
      where: { id: created.recommendation.id },
    });
    expect(after.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("never lets a learned preference through a hard filter", async () => {
    const a = await person("A");
    const candidates = [
      await person("B", ["climbing"], "北京", 31),
      await person("C", ["climbing"], "广州", 41),
      await person("D", ["climbing"], "成都", 51),
    ];
    for (const [index, candidate] of candidates.entries()) {
      await record({
        userId: a.id,
        candidateUserId: candidate.id,
        direction: "POSITIVE",
        sourceEventId: `pos-${index}`,
      });
    }
    // A confirms a boundary that excludes every climber it has learned to like.
    await prisma.preference.create({
      data: {
        userId: a.id,
        category: "boundary",
        key: "long_distance",
        value: "not_open",
        isHardFilter: true,
      },
    });
    const farClimber = await person("Far", ["climbing"], "北京", 30);

    const subjects = await Promise.all(
      [a.id, farClimber.id].map(async (id) => ({
        user: await prisma.user.findUniqueOrThrow({ where: { id } }),
        intent: "DATING" as const,
        hardFilters: await prisma.preference.findMany({ where: { userId: id, isHardFilter: true } }),
        signals: await prisma.relationshipSignal.findMany({ where: { userId: id, matchable: true } }),
        learned: await rankableLearnedPreferences(id),
      })),
    );
    expect(passesHardFilters(subjects[0], subjects[1]).rejectedBy).toBe("long_distance");
    expect(await nextRecommendation(a.id)).toEqual({ status: "NO_CANDIDATE" });
  });

  it("lets the user correct a hypothesis through the Agent", async () => {
    const a = await person("A");
    const b = await person("B", ["climbing"]);
    await record({ userId: a.id, candidateUserId: b.id, direction: "POSITIVE", sourceEventId: "e1" });

    const result = await runTool({ userId: a.id }, "correct_preference_hypothesis", {
      correction: "REJECT",
    });
    expect(result.ok).toBe(true);
    const rejected = await prisma.learnedPreference.count({
      where: { userId: a.id, status: "REJECTED" },
    });
    expect(rejected).toBe(1);
  });

  it("records a reaction to a recommendation as evidence, once", async () => {
    const a = await person("A");
    await person("B", ["climbing"]);
    const created = await nextRecommendation(a.id);
    if (created.status !== "CREATED") throw new Error("expected a recommendation");

    await respondToRecommendation({
      userId: a.id,
      recommendationId: created.recommendation.id,
      state: "INTERESTED",
    });
    await expect(
      respondToRecommendation({
        userId: a.id,
        recommendationId: created.recommendation.id,
        state: "INTERESTED",
      }),
    ).resolves.toBeTruthy();

    expect(
      await prisma.preferenceLearningEvent.count({
        where: { userId: a.id, eventType: "INTERESTED" },
      }),
    ).toBe(1);
  });
});
