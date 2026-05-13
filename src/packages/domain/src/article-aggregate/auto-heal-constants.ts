/**
 * 3 attempts before giving up. Captures the common transient-failure window
 * (DeepSeek burst overload, single SQS visibility cycle hiccup) without
 * unbounded retry of a deterministic bug.
 */
export const SUMMARY_AUTO_HEAL_MAX_ATTEMPTS = 3;

/**
 * After exhausting the attempt budget, wait 24h before considering another
 * round. Long enough that a model-side outage has resolved; short enough that
 * the reader sees the row self-heal within a typical reading session.
 */
export const SUMMARY_AUTO_HEAL_TTL_MS = 24 * 60 * 60 * 1000;
