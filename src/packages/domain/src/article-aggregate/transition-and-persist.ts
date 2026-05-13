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

/**
 * Upsert transitions accept `undefined` and synthesise a stub. Only the
 * entry-point transition `submitLink` is shaped this way; every other
 * transition requires an existing aggregate row.
 */
export type UpsertTransition<TInput> = (
	article: Article | undefined,
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

export type UpsertAndPersist = <TInput>(
	transition: UpsertTransition<TInput>,
	params: { url: string; input: TInput },
) => Promise<void>;

/**
 * The load → transition → save → dispatch orchestrator pair.
 *
 * Save and dispatch run in that order so a row's persisted state is always
 * caught up with the in-flight effects. If save throws, no effect dispatches.
 * If a dispatch throws after save succeeds, the caller (Lambda handler) sees
 * the failure and SQS retries: the next attempt re-loads the saved row,
 * re-runs the (idempotent) transition, re-saves identical state, and re-
 * dispatches. The summary worker short-circuits on cached `ready` rows so a
 * duplicate `generate-summary` is harmless.
 *
 * `transitionAndPersist` asserts the row exists (the regular path for state
 * mutations); `upsertAndPersist` does not (the entry-point path that may
 * synthesise a stub on first save). A transition that returns an empty
 * `writes` array skips the DDB write but still dispatches its effects — used
 * when submitLink lands on an in-flight row and only needs to re-dispatch.
 */
export function initTransitionAndPersist(deps: {
	store: ArticleStore;
	dispatchEffect: DispatchEffect;
}): {
	transitionAndPersist: TransitionAndPersist;
	upsertAndPersist: UpsertAndPersist;
} {
	const { store, dispatchEffect } = deps;

	const transitionAndPersist: TransitionAndPersist = async (
		transition,
		params,
	) => {
		const existing = await store.load(params.url);
		assert(existing, `Article aggregate not found for url: ${params.url}`);
		const result = transition(existing, params.input);
		await persistAndDispatch({ transitionName: transition.name, result });
	};

	const upsertAndPersist: UpsertAndPersist = async (transition, params) => {
		const existing = await store.load(params.url);
		const result = transition(existing, params.input);
		await persistAndDispatch({ transitionName: transition.name, result });
	};

	async function persistAndDispatch(params: {
		transitionName: string;
		result: {
			article: Article;
			effects: readonly Effect[];
			writes: readonly AggregateField[];
		};
	}): Promise<void> {
		const { transitionName, result } = params;
		if (result.writes.length > 0) {
			await store.save({
				article: result.article,
				transitionName,
				writes: result.writes,
			});
		}
		for (const effect of result.effects) {
			await dispatchEffect(effect);
		}
	}

	return { transitionAndPersist, upsertAndPersist };
}
