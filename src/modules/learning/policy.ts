import type { LearningStage } from "@prisma/client";

export const LEARNING_POLICY_VERSION = "v1";

/**
 * Later stages say something different from an early click, so they carry more
 * weight — but no stage is treated as proof on its own. The numbers are a
 * configurable starting point, not a measured truth.
 */
export const STAGE_WEIGHTS: Record<LearningStage, number> = {
  RECOMMENDATION: 0.4,
  INTEREST: 0.5,
  VIDEO: 0.7,
  POST_VIDEO: 1,
  CONTACT_EXCHANGE: 1.2,
  OFFLINE: 1.5,
};

/** A hypothesis needs evidence from several separate people before it counts. */
export const INDEPENDENT_EVIDENCE_TARGET = 3;

/** Below this, an unconfirmed hypothesis stays out of ranking entirely. */
export const SOFT_RANKING_THRESHOLD = 0.35;

/** Where the Agent may raise a hypothesis with the user instead of guessing. */
export const ASK_USER_THRESHOLD = 0.5;
