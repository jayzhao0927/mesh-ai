import type { ConnectionIntentType, RelationshipSignal, User } from "@prisma/client";

export const SCORING_POLICY_VERSION = "v1";

export interface ScoringSubject {
  user: User;
  intent: ConnectionIntentType | null;
  /** Confirmed, matchable signals only. Hypotheses never reach scoring. */
  signals: RelationshipSignal[];
}

export interface ScoreBreakdown {
  score: number;
  components: { name: string; weight: number; value: number; detail?: string }[];
  /** Plain-language reason shown to the user. Never a percentage or a rank. */
  reason: string;
}

const WEIGHTS = {
  intent: 0.3,
  sharedInterests: 0.3,
  location: 0.2,
  language: 0.1,
  ageProximity: 0.1,
} as const;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function interestSet(signals: RelationshipSignal[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of signals) {
    if (s.category !== "interest" && s.category !== "values") continue;
    map.set(`${s.category}:${normalize(s.value)}`, s.value);
  }
  return map;
}

function sharedInterests(a: ScoringSubject, b: ScoringSubject): string[] {
  const left = interestSet(a.signals);
  const right = interestSet(b.signals);
  const shared: string[] = [];
  for (const [key, label] of left) {
    if (right.has(key)) shared.push(label);
  }
  return shared.sort();
}

/**
 * Deterministic compatibility score. The same two profiles always produce the
 * same number, and the number stays internal: users only ever see `reason`.
 */
export function scorePair(a: ScoringSubject, b: ScoringSubject): ScoreBreakdown {
  const components: ScoreBreakdown["components"] = [];

  const intentValue = a.intent && b.intent && a.intent === b.intent ? 1 : a.intent && b.intent ? 0.5 : 0.25;
  components.push({
    name: "intent",
    weight: WEIGHTS.intent,
    value: intentValue,
    detail: a.intent && a.intent === b.intent ? "same intent" : undefined,
  });

  const shared = sharedInterests(a, b);
  components.push({
    name: "sharedInterests",
    weight: WEIGHTS.sharedInterests,
    value: Math.min(shared.length, 3) / 3,
    detail: shared.slice(0, 3).join(", ") || undefined,
  });

  const sameCity = Boolean(a.user.city && a.user.city === b.user.city);
  components.push({
    name: "location",
    weight: WEIGHTS.location,
    value: sameCity ? 1 : 0,
    detail: sameCity ? (a.user.city ?? undefined) : undefined,
  });

  const sharedLanguages = a.user.languages.filter((l) => b.user.languages.includes(l));
  components.push({
    name: "language",
    weight: WEIGHTS.language,
    value: sharedLanguages.length > 0 ? 1 : 0,
    detail: sharedLanguages[0],
  });

  const ageGap =
    a.user.ageYears != null && b.user.ageYears != null
      ? Math.abs(a.user.ageYears - b.user.ageYears)
      : null;
  components.push({
    name: "ageProximity",
    weight: WEIGHTS.ageProximity,
    value: ageGap == null ? 0.5 : Math.max(0, 1 - ageGap / 15),
  });

  const score = Number(
    components.reduce((sum, c) => sum + c.weight * c.value, 0).toFixed(4),
  );

  return { score, components, reason: buildReason(components) };
}

function buildReason(components: ScoreBreakdown["components"]): string {
  const parts: string[] = [];
  const shared = components.find((c) => c.name === "sharedInterests");
  if (shared?.detail) parts.push(`you both care about ${shared.detail}`);
  const location = components.find((c) => c.name === "location");
  if (location?.detail) parts.push(`you're both in ${location.detail}`);
  const intent = components.find((c) => c.name === "intent");
  if (intent?.detail) parts.push("you're looking for the same kind of connection");
  if (parts.length === 0) return "I think the way you each talk about people would land well.";
  return parts.join(", and ");
}
