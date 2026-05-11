import type { DispatchEffect } from "@packages/domain/article-aggregate";
import type { GenerateSummaryCommand } from "@packages/hutch-infra-components";
import type { DispatchCommand } from "@packages/hutch-infra-components/runtime";

/**
 * Wires the typed Effect union to the existing SQS command dispatchers.
 * The orchestrator iterates effects after a successful store.save(), so a
 * thrown SQS failure propagates back to the Lambda handler and SQS retries
 * the whole transition.
 *
 * The function body is intentionally narrow: when a new Effect variant is
 * added to `@packages/domain/article-aggregate`, TypeScript will refuse to
 * compile the unconditional access to `effect.url` (the new variant's shape
 * won't carry it) — forcing the dispatcher to be extended in lockstep.
 */
export function initLambdaEffectDispatcher(deps: {
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
}): { dispatchEffect: DispatchEffect } {
	const { dispatchGenerateSummary } = deps;

	const dispatchEffect: DispatchEffect = async (effect) => {
		await dispatchGenerateSummary({ url: effect.url });
	};

	return { dispatchEffect };
}
