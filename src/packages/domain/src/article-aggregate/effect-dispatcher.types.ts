import type { Effect } from "./effects.types";

/**
 * Dispatch a single Effect on whatever transport the composition root wired
 * up. The orchestrator iterates effects serially and propagates any throw,
 * so a partial dispatch surfaces as a Lambda failure and SQS retries the
 * whole transition. The downstream `generate-summary` worker is idempotent
 * (it short-circuits on cached ready rows), so duplicate dispatches are safe.
 */
export type DispatchEffect = (effect: Effect) => Promise<void>;
