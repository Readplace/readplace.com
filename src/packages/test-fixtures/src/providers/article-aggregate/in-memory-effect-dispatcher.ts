import type {
	DispatchEffect,
	Effect,
} from "@packages/domain/article-aggregate";

/**
 * In-memory effect dispatcher for tests. Records every dispatched effect on
 * a public `dispatched` array so end-to-end tests can assert that the
 * orchestrator fired the right effects after a successful save.
 */
export function initInMemoryEffectDispatcher(): {
	dispatchEffect: DispatchEffect;
	dispatched: Effect[];
} {
	const dispatched: Effect[] = [];
	const dispatchEffect: DispatchEffect = async (effect) => {
		dispatched.push(effect);
	};
	return { dispatchEffect, dispatched };
}
