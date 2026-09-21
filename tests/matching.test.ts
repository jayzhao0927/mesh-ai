import { describe, expect, it } from "vitest";
import { prisma } from "@/modules/shared/db";
import {
  nextRecommendation,
  openRecommendation,
  respondToRecommendation,
} from "@/modules/matching/service";
import { passesHardFilters } from "@/modules/matching/filters";
import { scorePair } from "@/modules/matching/scoring";
import { runTool } from "@/modules/agent/tools";
import { completeVerification, startVerification } from "@/modules/verification/service";
import type { ConnectionIntentType, Prisma } from "@prisma/client";

interface PersonSpec {
  name: string;
  age?: number;
  city?: string;
  languages?: string[];
  intent?: ConnectionIntentType;
  interests?: string[];
  isDemo?: boolean;
  verified?: boolean;
}

async function person(spec: PersonSpec) {
  const user = await prisma.user.create({
    data: {
      displayName: spec.name,
      ageYears: spec.age ?? 30,
      city: spec.city ?? "上海",
      languages: spec.languages ?? ["zh"],
      isDemo: spec.isDemo ?? false,
    },
  });
  if (spec.verified !== false) {
    const { token } = await startVerification(user.id);
    await completeVerification(token);
  }
  if (spec.intent) {
    await prisma.connectionIntent.create({ data: { userId: user.id, intent: spec.intent } });
  }
  for (const value of spec.interests ?? []) {
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
  return prisma.user.findUniqueOrThrow({ where: { id: user.id } });
}

function subject(
  user: Awaited<ReturnType<typeof person>>,
  extras: {
    intent?: ConnectionIntentType | null;
    hardFilters?: Prisma.PreferenceUncheckedCreateInput[];
  } = {},
) {
  return {
    user,
    intent: extras.intent ?? null,
    hardFilters: (extras.hardFilters ?? []).map((f, index) => ({
      id: `pref-${index}`,
      userId: user.id,
      category: f.category,
      key: f.key,
      value: f.value,
      isHardFilter: true,
      statedAt: new Date(),
      supersededAt: null,
    })),
    signals: [],
  };
}

describe("hard filters", () => {
  it("are mutual: either side's non-negotiable blocks the pair", async () => {
    const a = await person({ name: "A", age: 30, city: "上海" });
    const b = await person({ name: "B", age: 45, city: "上海" });

    const withFilter = subject(a, {
      hardFilters: [{ userId: a.id, category: "preference", key: "age_max", value: "38" }],
    });
    expect(passesHardFilters(withFilter, subject(b)).passed).toBe(false);
    // A filter held by the candidate blocks the pair just as hard.
    const reversed = subject(b, {
      hardFilters: [{ userId: b.id, category: "preference", key: "age_min", value: "40" }],
    });
    expect(passesHardFilters(subject(a), reversed).passed).toBe(false);
  });

  it("outrank a high compatibility score", async () => {
    const a = await person({ name: "A", city: "上海", interests: ["climbing"] });
    const b = await person({ name: "B", city: "北京", interests: ["climbing"] });
    const filtered = subject(a, {
      hardFilters: [{ userId: a.id, category: "boundary", key: "long_distance", value: "not_open" }],
    });
    const other = subject(b);

    expect(scorePair(filtered, other).score).toBeGreaterThan(0);
    expect(passesHardFilters(filtered, other).rejectedBy).toBe("long_distance");
  });

  it("keep unverified people out of the pool", async () => {
    const a = await person({ name: "A" });
    const b = await person({ name: "B", verified: false });
    expect(passesHardFilters(subject(a), subject(b)).rejectedBy).toBe("candidate_not_eligible");
  });
});

describe("scoring", () => {
  it("is deterministic and never exposes a percentage to the user", async () => {
    const a = await person({ name: "A", interests: ["climbing", "coffee"] });
    const b = await person({ name: "B", interests: ["climbing", "coffee"] });
    const left = { ...subject(a), signals: await signalsOf(a.id) };
    const right = { ...subject(b), signals: await signalsOf(b.id) };

    const first = scorePair(left, right);
    const second = scorePair(left, right);
    expect(first.score).toBe(second.score);
    expect(first.reason).not.toMatch(/\d+\s*%/);
  });
});

async function signalsOf(userId: string) {
  return prisma.relationshipSignal.findMany({ where: { userId, matchable: true } });
}

describe("recommendations", () => {
  it("refuses to recommend anyone before verification", async () => {
    const a = await person({ name: "A", verified: false });
    await person({ name: "B", intent: "DATING" });
    const outcome = await nextRecommendation(a.id);
    expect(outcome).toEqual({ status: "NOT_ELIGIBLE", reason: "UNVERIFIED" });
  });

  it("shows one person at a time until that one is answered", async () => {
    const a = await person({ name: "A", intent: "DATING", interests: ["climbing"] });
    await person({ name: "B", intent: "DATING", interests: ["climbing"] });
    await person({ name: "C", intent: "DATING", interests: ["climbing"] });

    const first = await nextRecommendation(a.id);
    expect(first.status).toBe("CREATED");
    const second = await nextRecommendation(a.id);
    expect(second.status).toBe("ALREADY_PENDING");

    const open = await openRecommendation(a.id);
    await respondToRecommendation({
      userId: a.id,
      recommendationId: open!.id,
      state: "NOT_INTERESTED",
    });
    const third = await nextRecommendation(a.id);
    expect(third.status).toBe("CREATED");
    if (third.status !== "CREATED" || first.status !== "CREATED") throw new Error("unreachable");
    expect(third.recommendation.candidateUserId).not.toBe(first.recommendation.candidateUserId);
  });

  it("only creates a connection once both sides said yes", async () => {
    const a = await person({ name: "A", intent: "DATING" });
    const b = await person({ name: "B", intent: "DATING" });

    const recA = await nextRecommendation(a.id);
    if (recA.status !== "CREATED") throw new Error("expected a recommendation");
    const one = await respondToRecommendation({
      userId: a.id,
      recommendationId: recA.recommendation.id,
      state: "INTERESTED",
    });
    expect(one.mutual).toBe(false);
    expect(await prisma.connection.count()).toBe(0);

    const recB = await nextRecommendation(b.id);
    if (recB.status !== "CREATED") throw new Error("expected a recommendation");
    const two = await respondToRecommendation({
      userId: b.id,
      recommendationId: recB.recommendation.id,
      state: "INTERESTED",
    });
    expect(two.mutual).toBe(true);
    expect(await prisma.connection.count()).toBe(1);
  });

  it("treats 'later' as neutral evidence, not a rejection", async () => {
    const a = await person({ name: "A", intent: "DATING" });
    await person({ name: "B", intent: "DATING" });
    const rec = await nextRecommendation(a.id);
    if (rec.status !== "CREATED") throw new Error("expected a recommendation");

    await respondToRecommendation({
      userId: a.id,
      recommendationId: rec.recommendation.id,
      state: "LATER",
    });
    const event = await prisma.preferenceLearningEvent.findFirstOrThrow({
      where: { userId: a.id },
    });
    expect(event.signalDirection).toBe("NEUTRAL");
    expect(event.weight).toBe(0);
  });

  it("refuses to answer a recommendation that belongs to someone else", async () => {
    const a = await person({ name: "A", intent: "DATING" });
    const b = await person({ name: "B", intent: "DATING" });
    const rec = await nextRecommendation(a.id);
    if (rec.status !== "CREATED") throw new Error("expected a recommendation");

    await expect(
      respondToRecommendation({
        userId: b.id,
        recommendationId: rec.recommendation.id,
        state: "INTERESTED",
      }),
    ).rejects.toThrow(/another user/);
    await expect(
      runTool({ userId: b.id }, "respond_to_recommendation", {
        state: "INTERESTED",
        recommendationId: rec.recommendation.id,
      }),
    ).rejects.toThrow(/Not authorized/);
  });

  it("never introduces a real person to a demo profile's agent", async () => {
    const demo = await person({ name: "Demo", intent: "DATING", isDemo: true });
    await person({ name: "Real", intent: "DATING" });
    expect(await nextRecommendation(demo.id)).toEqual({ status: "NO_CANDIDATE" });
  });

  it("pauses introductions when the user asked to stop", async () => {
    const a = await person({ name: "A", intent: "DATING" });
    await person({ name: "B", intent: "DATING" });
    await runTool({ userId: a.id }, "pause_connections", {});
    const outcome = await nextRecommendation(a.id);
    expect(outcome).toEqual({ status: "NOT_ELIGIBLE", reason: "PAUSED" });
  });
});
