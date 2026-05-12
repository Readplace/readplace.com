import assert from "node:assert";
import type { Article } from "./article.types";
import type { DispatchEffect } from "./effect-dispatcher.types";
import type { Effect } from "./effects.types";
import type { AggregateField, ArticleStore } from "./storage.types";

export type Transition<TInput> = (
	article: Article,
	input: TInput,
) => {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
};

export type TransitionAndPersist = <TInput>(
	transition: Transition<TInput>,
	params: { url: string; input: TInput },
) => Promise<void>;

/**
 * The single load → transition → save → dispatch orchestrator.
 *
 * Save and dispatch run in that order so a row's persisted state is always
 * caught up with the in-flight effects. If save throws, no effect dispatches.
 * If a dispatch throws after save succeeds, the caller (Lambda handler) sees
 * the failure and SQS retries: the next attempt re-loads the saved row,
 * re-runs the (idempotent) transition, re-saves identical state, and re-
 * dispatches. The summary worker short-circuits on cached `ready` rows so a
 * duplicate `generate-summary` is harmless.
 */
export function initTransitionAndPersist(deps: {
	store: ArticleStore;
	dispatchEffect: DispatchEffect;
}): { transitionAndPersist: TransitionAndPersist } {
	const { store, dispatchEffect } = deps;

	const transitionAndPersist: TransitionAndPersist = async (
		transition,
		params,
	) => {
		const existing = await store.load(params.url);
		assert(existing, `Article aggregate not found for url: ${params.url}`);
		const { article, effects, writes } = transition(existing, params.input);
		await store.save({
			article,
			transitionName: transition.name,
			writes,
		});
		for (const effect of effects) {
			await dispatchEffect(effect);
		}
	};

	return { transitionAndPersist };
}
