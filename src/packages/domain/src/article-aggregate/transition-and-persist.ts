import assert from "node:assert";
import type { Article, CrawlState } from "./article.types";
import type { DispatchEffect } from "./effect-dispatcher.types";
import type { Effect } from "./effects.types";
import type { AggregateField, ArticleStore } from "./storage.types";
import type { CanonicalCommit, SelectionExpected } from "./content-selection.types";

export type Transition<TInput> = (
	article: Article,
	input: TInput,
) => {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
};

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
	params: { url: string; input: TInput; canonicalCommit?: CanonicalCommit; selectionExpected?: SelectionExpected },
) => Promise<void>;

export type LogCrawlSettled = (params: {
	startedAt: string;
	outcome: "ready" | "failed" | "unsupported";
}) => void;

export type UpsertAndPersist = <TInput>(
	transition: UpsertTransition<TInput>,
	params: { url: string; input: TInput },
) => Promise<void>;

/**
 * Load → transition → save → dispatch orchestrator for the Article aggregate.
 *
 * Returns two variants:
 *
 * - `transitionAndPersist` — the row MUST exist; asserts otherwise. Used by
 *   every save-link Lambda that mutates an existing aggregate.
 * - `upsertAndPersist` — the row MAY be absent. The transition synthesises a
 *   first-save stub when `article === undefined`. Used by entry-point save
 *   transitions (e.g. `submitLink`) where the queue card must render at t=0.
 *
 * Both share the save-before-dispatch ordering: if save throws no effect
 * dispatches; if a dispatch throws after save succeeds the caller sees the
 * failure and SQS retries from the persisted state. Both skip the storage
 * `save` call entirely when the transition returns an empty `writes` array —
 * e.g. `submitLink` on an in-flight pending row only needs to re-dispatch,
 * not re-write.
 */
export function initTransitionAndPersist(deps: {
	store: ArticleStore;
	dispatchEffect: DispatchEffect;
	logCrawlSettled: LogCrawlSettled;
}): {
	transitionAndPersist: TransitionAndPersist;
	upsertAndPersist: UpsertAndPersist;
} {
	const { store, dispatchEffect, logCrawlSettled } = deps;

	async function persistAndDispatch(params: {
		previousCrawl: CrawlState | undefined;
		article: Article;
		effects: readonly Effect[];
		writes: readonly AggregateField[];
		canonicalCommit?: CanonicalCommit;
		selectionExpected?: SelectionExpected;
	}): Promise<void> {
		if (params.writes.length > 0) {
			await store.save({
				article: params.article,
				writes: params.writes,
				canonicalCommit: params.canonicalCommit,
				selectionExpected: params.selectionExpected,
			});
			const settled = params.article.crawl;
			if (
				params.writes.includes("crawl") &&
				params.previousCrawl?.kind === "pending" &&
				params.previousCrawl.startedAt !== undefined &&
				settled.kind !== "pending"
			) {
				logCrawlSettled({ startedAt: params.previousCrawl.startedAt, outcome: settled.kind });
			}
		}
		for (const effect of params.effects) {
			await dispatchEffect(effect);
		}
	}

	const transitionAndPersist: TransitionAndPersist = async (
		transition,
		params,
	) => {
		const existing = await store.load(params.url);
		assert(existing, `Article aggregate not found for url: ${params.url}`);
		const { article, effects, writes } = transition(existing, params.input);
		await persistAndDispatch({
			previousCrawl: existing.crawl,
			article,
			effects,
			writes,
			canonicalCommit: params.canonicalCommit,
			selectionExpected: params.selectionExpected,
		});
	};

	const upsertAndPersist: UpsertAndPersist = async (transition, params) => {
		const existing = await store.load(params.url);
		const { article, effects, writes } = transition(existing, params.input);
		await persistAndDispatch({
			previousCrawl: existing?.crawl,
			article,
			effects,
			writes,
		});
	};

	return { transitionAndPersist, upsertAndPersist };
}
