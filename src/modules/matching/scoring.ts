import type {
  ConnectionIntentType,
  LearnedPreference,
  RelationshipSignal,
  User,
} from "@prisma/client";

export const SCORING_POLICY_VERSION = "v2";

export interface ScoringSubject {
  user: User;
  intent: ConnectionIntentType | null;
  /** Confirmed, matchable signals only. Unreviewed inferences never reach scoring. */
  signals: RelationshipSignal[];
  /**
   * Hypotheses that earned a place in ranking. They can only ever nudge the
   * order of people who already passed the hard filters.
   */
  learned?: LearnedPreference[];
}

export interface ScoreBreakdown {
  score: number;
  components: { name: string; weight: number; value: number; detail?: string }[];
  /** Plain-language reason shown to the user. Never a percentage or a rank. */
  reason: string;
  /** Which hypotheses moved this score, so a correction can undo their effect. */
  learnedPreferenceIds: string[];
}

const WEIGHTS = {
  intent: 0.28,
  sharedInterests: 0.28,
  location: 0.18,
  language: 0.08,
  ageProximity: 0.08,
  learnedFit: 0.1,
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

  const learned = learnedFit(a, b);
  components.push({
    name: "learnedFit",
    weight: WEIGHTS.learnedFit,
    value: learned.value,
    detail: learned.detail,
  });

  const score = Number(
    components.reduce((sum, c) => sum + c.weight * c.value, 0).toFixed(4),
  );

  return {
    score,
    components,
    reason: buildReason(components),
    learnedPreferenceIds: learned.ids,
  };
}

/**
 * A small nudge from what the user's real connections suggested so far. Only
 * confirmed hypotheses are ever put into words to the user — an observation
 * stays silent until they have had a say.
 */
function learnedFit(
  a: ScoringSubject,
  b: ScoringSubject,
): { value: number; detail?: string; ids: string[] } {
  const hypotheses = a.learned ?? [];
  if (hypotheses.length === 0) return { value: 0, ids: [] };

  const candidateInterests = new Set(
    b.signals.filter((s) => s.category === "interest").map((s) => normalize(s.value)),
  );
  const matched = hypotheses.filter((h) => {
    if (h.category === "interest") return candidateInterests.has(normalize(h.value));
    if (h.key === "same_city_candidate") return normalize(h.value) === normalize(b.user.city ?? "");
    if (h.key === "age_band" && b.user.ageYears != null) {
      const band = Math.floor(b.user.ageYears / 5) * 5;
      return h.value === `${band}-${band + 4}`;
    }
    return false;
  });
  if (matched.length === 0) return { value: 0, ids: [] };

  const confirmed = matched.filter((m) => m.status === "CONFIRMED");
  return {
    value: Math.min(matched.length, 2) / 2,
    detail: confirmed[0]?.value,
    ids: matched.map((m) => m.id),
  };
}

function buildReason(components: ScoreBreakdown["components"]): string {
  const parts: string[] = [];
  const shared = components.find((c) => c.name === "sharedInterests");
  if (shared?.detail) parts.push(`you both care about ${shared.detail}`);
  const location = components.find((c) => c.name === "location");
  if (location?.detail) parts.push(`you're both in ${location.detail}`);
  const intent = components.find((c) => c.name === "intent");
  if (intent?.detail) parts.push("you're looking for the same kind of connection");
  const learned = components.find((c) => c.name === "learnedFit");
  if (learned?.detail) parts.push(`it lines up with what you told me matters (${learned.detail})`);
  if (parts.length === 0) return "I think the way you each talk about people would land well.";
  return parts.join(", and ");
}
