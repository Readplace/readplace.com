import type {
	DispatchEffect,
	Effect,
} from "@packages/domain/article-aggregate";
import type { GenerateSummaryCommand } from "@packages/hutch-infra-components";
import type { DispatchCommand } from "@packages/hutch-infra-components/runtime";

/**
 * Wires the typed Effect union to the existing SQS command dispatchers.
 * The orchestrator iterates effects after a successful store.save(), so a
 * thrown SQS failure propagates back to the Lambda handler and SQS retries
 * the whole transition.
 *
 * The `satisfies Record<Effect["kind"], ...>` assertion ensures that adding
 * a new Effect variant without a handler here is a compile error.
 */
export function initLambdaEffectDispatcher(deps: {
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
}): { dispatchEffect: DispatchEffect } {
	const { dispatchGenerateSummary } = deps;

	const dispatchEffect: DispatchEffect = async (effect) => {
		const handlers = {
			"generate-summary": () =>
				dispatchGenerateSummary({ url: effect.url }),
		} satisfies Record<Effect["kind"], () => Promise<void>>;

		await handlers[effect.kind]();
	};

	return { dispatchEffect };
}
