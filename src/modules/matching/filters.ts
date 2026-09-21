import type { ConnectionIntentType, Preference, User } from "@prisma/client";

export interface FilterSubject {
  user: User;
  intent: ConnectionIntentType | null;
  hardFilters: Preference[];
}

export interface FilterOutcome {
  passed: boolean;
  /** Internal, never shown to either side. */
  rejectedBy?: string;
}

/**
 * Intents only pair up when both sides are looking for the same kind of
 * relationship. Open-ended intents pair with anything except an explicit
 * mismatch, so nobody is filtered out just for still figuring it out.
 */
const OPEN_ENDED: ConnectionIntentType[] = ["MEANINGFUL_CONNECTION", "UNSURE", "OTHER"];
const ROMANTIC: ConnectionIntentType[] = ["DATING", "MARRIAGE"];

function intentsCompatible(
  a: ConnectionIntentType | null,
  b: ConnectionIntentType | null,
): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  if (OPEN_ENDED.includes(a) || OPEN_ENDED.includes(b)) return true;
  if (ROMANTIC.includes(a) && ROMANTIC.includes(b)) return true;
  return false;
}

function filterValue(filters: Preference[], key: string): string | undefined {
  return filters.find((f) => f.key === key)?.value;
}

/**
 * One direction of the hard filters: does `candidate` satisfy everything
 * `subject` said is non-negotiable? Hard filters run before any scoring and
 * before any learned preference, and a failure is absolute.
 */
function satisfiesOneWay(subject: FilterSubject, candidate: FilterSubject): FilterOutcome {
  const { hardFilters } = subject;

  const ageMin = filterValue(hardFilters, "age_min");
  const ageMax = filterValue(hardFilters, "age_max");
  if (ageMin || ageMax) {
    const age = candidate.user.ageYears;
    if (age == null) return { passed: false, rejectedBy: "age_unknown" };
    if (ageMin && age < Number(ageMin)) return { passed: false, rejectedBy: "age_min" };
    if (ageMax && age > Number(ageMax)) return { passed: false, rejectedBy: "age_max" };
  }

  const longDistance = filterValue(hardFilters, "long_distance");
  const sameCity = filterValue(hardFilters, "same_city");
  if (longDistance === "not_open" || sameCity === "required") {
    if (!subject.user.city || !candidate.user.city) {
      return { passed: false, rejectedBy: "city_unknown" };
    }
    if (subject.user.city !== candidate.user.city) {
      return { passed: false, rejectedBy: "long_distance" };
    }
  }

  const language = filterValue(hardFilters, "language");
  if (language && !candidate.user.languages.includes(language)) {
    return { passed: false, rejectedBy: "language" };
  }

  return { passed: true };
}

/** Hard filters are mutual: both sides must accept the other. */
export function passesHardFilters(a: FilterSubject, b: FilterSubject): FilterOutcome {
  if (a.user.id === b.user.id) return { passed: false, rejectedBy: "self" };
  if (a.user.status !== "ACTIVE") return { passed: false, rejectedBy: "subject_inactive" };
  if (b.user.status !== "ACTIVE") return { passed: false, rejectedBy: "candidate_inactive" };
  if (!a.user.poolEligibleAt) return { passed: false, rejectedBy: "subject_not_eligible" };
  if (!b.user.poolEligibleAt) return { passed: false, rejectedBy: "candidate_not_eligible" };
  if (!intentsCompatible(a.intent, b.intent)) {
    return { passed: false, rejectedBy: "intent" };
  }

  const forward = satisfiesOneWay(a, b);
  if (!forward.passed) return forward;
  const backward = satisfiesOneWay(b, a);
  if (!backward.passed) {
    return { passed: false, rejectedBy: `candidate_filter:${backward.rejectedBy}` };
  }
  return { passed: true };
}
