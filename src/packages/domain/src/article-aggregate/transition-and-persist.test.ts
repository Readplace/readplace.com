import assert from "node:assert/strict";
import type { Article } from "./article.types";
import type { DispatchEffect } from "./effect-dispatcher.types";
import type { Effect } from "./effects.types";
import type { AggregateField, ArticleStore, SaveArticle } from "./storage.types";
import {
	initTransitionAndPersist,
	type Transition,
	type UpsertTransition,
} from "./transition-and-persist";

function seededArticle(url: string): Article {
	return {
		url,
		metadata: {
			title: "Title",
			siteName: "Example",
			excerpt: "Excerpt",
			wordCount: 100,
		},
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: { kind: "ready", summary: "Old" },
		summaryAutoHeal: { attempts: 0 },
	};
}

interface SavedCall {
	article: Article;
	transitionName: string;
	writes: readonly AggregateField[];
}

function createFakeStore(initial: readonly Article[]): {
	store: ArticleStore;
	saved: SavedCall[];
} {
	const rows = new Map<string, Article>();
	for (const a of initial) rows.set(a.url, a);
	const saved: SavedCall[] = [];

	const save: SaveArticle = async ({ article, transitionName, writes }) => {
		saved.push({ article, transitionName, writes });
		rows.set(article.url, article);
	};
	const store: ArticleStore = {
		load: async (url) => rows.get(url),
		save,
	};

	return { store, saved };
}

describe("initTransitionAndPersist", () => {
	const URL = "https://example.com/article";

	it("loads, transitions, saves, then dispatches effects in that order", async () => {
		const order: string[] = [];
		const seed = seededArticle(URL);

		const save: SaveArticle = async ({ article }) => {
			order.push(`save:${article.summary.kind}`);
		};
		const store: ArticleStore = {
			load: async (url) => {
				order.push(`load:${url}`);
				return seed;
			},
			save,
		};
		const dispatchEffect: DispatchEffect = async (effect) => {
			order.push(`dispatch:${effect.kind}`);
		};

		function exampleTransition(article: Article): {
			article: Article;
			effects: readonly Effect[];
			writes: readonly AggregateField[];
		} {
			return {
				article: { ...article, summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" } },
				effects: [{ kind: "generate-summary", url: article.url }],
				writes: ["summary"],
			};
		}

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await transitionAndPersist(exampleTransition, { url: URL, input: undefined });

		assert.deepEqual(order, [
			`load:${URL}`,
			"save:pending",
			"dispatch:generate-summary",
		]);
	});

	it("threads the transition function's name through to store.save so the canary can attribute stuck rows", async () => {
		const { store, saved } = createFakeStore([seededArticle(URL)]);
		const dispatchEffect: DispatchEffect = async () => {};
		function exampleTransition(article: Article): {
			article: Article;
			effects: readonly Effect[];
			writes: readonly AggregateField[];
		} {
			return { article, effects: [], writes: ["summary"] };
		}

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await transitionAndPersist(exampleTransition, { url: URL, input: undefined });

		assert.equal(saved.length, 1);
		assert.equal(saved[0]?.transitionName, "exampleTransition");
	});

	it("threads the transition's writes scope through to store.save so the storage adapter can omit untouched axes", async () => {
		const { store, saved } = createFakeStore([seededArticle(URL)]);
		const dispatchEffect: DispatchEffect = async () => {};
		function exampleTransition(article: Article): {
			article: Article;
			effects: readonly Effect[];
			writes: readonly AggregateField[];
		} {
			return {
				article: {
					...article,
					crawl: { kind: "failed", reason: { kind: "fetch-failed" } },
				},
				effects: [],
				writes: ["crawl", "summary"],
			};
		}

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await transitionAndPersist(exampleTransition, { url: URL, input: undefined });

		assert.deepEqual([...(saved[0]?.writes ?? [])], ["crawl", "summary"]);
	});

	it("throws when the aggregate is missing so SQS retries the whole transition", async () => {
		const save: SaveArticle = async () => {
			throw new Error("save must not be called when load returns undefined");
		};
		const store: ArticleStore = {
			load: async () => undefined,
			save,
		};
		const dispatchEffect: DispatchEffect = async () => {
			throw new Error("dispatch must not be called when load returns undefined");
		};
		const transition: Transition<undefined> = (article) => ({
			article,
			effects: [],
			writes: [],
		});

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await assert.rejects(
			transitionAndPersist(transition, { url: URL, input: undefined }),
			(err: Error) =>
				err.message.includes("Article aggregate not found for url"),
		);
	});

	it("does not dispatch when save throws (handler's catch path drives SQS retry)", async () => {
		const seed = seededArticle(URL);
		const save: SaveArticle = async () => {
			throw new Error("ddb throttled");
		};
		const store: ArticleStore = {
			load: async () => seed,
			save,
		};
		const dispatched: Effect[] = [];
		const dispatchEffect: DispatchEffect = async (effect) => {
			dispatched.push(effect);
		};
		const transition: Transition<undefined> = (article) => ({
			article,
			effects: [{ kind: "generate-summary", url: article.url }],
			writes: ["summary"],
		});

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await assert.rejects(
			transitionAndPersist(transition, { url: URL, input: undefined }),
			/ddb throttled/,
		);
		assert.deepEqual(dispatched, []);
	});

	it("propagates a dispatcher failure so SQS retry replays save (idempotent) and re-dispatches", async () => {
		const { store } = createFakeStore([seededArticle(URL)]);
		const dispatchEffect: DispatchEffect = async () => {
			throw new Error("sqs send failed");
		};
		const transition: Transition<undefined> = (article) => ({
			article,
			effects: [{ kind: "generate-summary", url: article.url }],
			writes: ["summary"],
		});

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await assert.rejects(
			transitionAndPersist(transition, { url: URL, input: undefined }),
			/sqs send failed/,
		);
	});

	it("redelivery: dispatch fails after save, SQS retries, second attempt re-loads persisted state and dispatches", async () => {
		const { store, saved } = createFakeStore([seededArticle(URL)]);
		const dispatched: Effect[] = [];
		let dispatchCallCount = 0;

		const dispatchEffect: DispatchEffect = async (effect) => {
			dispatchCallCount++;
			if (dispatchCallCount === 1) throw new Error("sqs send failed");
			dispatched.push(effect);
		};

		const transition: Transition<undefined> = (article) => ({
			article: { ...article, summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" } },
			effects: [{ kind: "generate-summary", url: article.url }],
			writes: ["summary"],
		});

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await assert.rejects(
			transitionAndPersist(transition, { url: URL, input: undefined }),
			/sqs send failed/,
		);

		assert.equal(saved.length, 1, "first call persisted the transition");
		assert.equal(saved[0]?.article.summary.kind, "pending");
		assert.deepEqual(dispatched, [], "first call did not dispatch");

		await transitionAndPersist(transition, { url: URL, input: undefined });

		assert.equal(saved.length, 2, "second call re-saved idempotently");
		assert.equal(saved[1]?.article.summary.kind, "pending");
		assert.deepEqual(dispatched, [{ kind: "generate-summary", url: URL }]);
	});

	it("dispatches every effect emitted by the transition in declared order", async () => {
		const { store } = createFakeStore([seededArticle(URL)]);
		const dispatched: Effect[] = [];
		const dispatchEffect: DispatchEffect = async (effect) => {
			dispatched.push(effect);
		};
		const transition: Transition<undefined> = (article) => ({
			article,
			effects: [
				{ kind: "generate-summary", url: article.url },
				{ kind: "publish-recrawl-completed", url: article.url },
			],
			writes: [],
		});

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await transitionAndPersist(transition, { url: URL, input: undefined });

		assert.deepEqual(dispatched, [
			{ kind: "generate-summary", url: URL },
			{ kind: "publish-recrawl-completed", url: URL },
		]);
	});

	it("threads the input through to the transition so writers can pass payload data", async () => {
		const { store, saved } = createFakeStore([seededArticle(URL)]);
		const dispatchEffect: DispatchEffect = async () => {};
		const transition: Transition<{ newTitle: string }> = (article, input) => ({
			article: {
				...article,
				metadata: { ...article.metadata, title: input.newTitle },
			},
			effects: [],
			writes: ["metadata"],
		});

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await transitionAndPersist(transition, {
			url: URL,
			input: { newTitle: "Updated" },
		});

		assert.equal(saved.length, 1);
		assert.equal(saved[0]?.article.metadata.title, "Updated");
	});

	it("skips store.save when the transition returns an empty writes array (idempotent no-op on row, effects still dispatched)", async () => {
		const { store, saved } = createFakeStore([seededArticle(URL)]);
		const dispatched: Effect[] = [];
		const dispatchEffect: DispatchEffect = async (effect) => {
			dispatched.push(effect);
		};
		const transition: Transition<undefined> = (article) => ({
			article,
			effects: [{ kind: "generate-summary", url: article.url }],
			writes: [],
		});

		const { transitionAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await transitionAndPersist(transition, { url: URL, input: undefined });

		assert.deepEqual(saved, []);
		assert.deepEqual(dispatched, [{ kind: "generate-summary", url: URL }]);
	});
});

describe("upsertAndPersist", () => {
	const URL = "https://example.com/article";

	it("synthesises a row when load returns undefined (first-save upsert)", async () => {
		const { store, saved } = createFakeStore([]);
		const dispatched: Effect[] = [];
		const dispatchEffect: DispatchEffect = async (effect) => {
			dispatched.push(effect);
		};

		const stubArticle: Article = {
			url: URL,
			metadata: { title: "Synth", siteName: "example.com", excerpt: "", wordCount: 0 },
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			estimatedReadTime: 1,
			crawl: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
			summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
			summaryAutoHeal: { attempts: 0 },
		};

		function upsertTransition(article: Article | undefined): {
			article: Article;
			effects: readonly Effect[];
			writes: readonly AggregateField[];
		} {
			return {
				article: article ?? stubArticle,
				effects: [{ kind: "generate-summary", url: URL }],
				writes: article ? [] : ["metadata", "freshness", "crawl", "summary"],
			};
		}

		const { upsertAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await upsertAndPersist(upsertTransition, { url: URL, input: undefined });

		assert.equal(saved.length, 1);
		assert.equal(saved[0]?.article, stubArticle);
		assert.deepEqual(dispatched, [{ kind: "generate-summary", url: URL }]);
	});

	it("passes the existing article when load returns a row (re-save path)", async () => {
		const seed = seededArticle(URL);
		const { store, saved } = createFakeStore([seed]);
		const dispatchEffect: DispatchEffect = async () => {};
		const seen: Array<Article | undefined> = [];

		const upsertTransition: UpsertTransition<undefined> = (article) => {
			seen.push(article);
			return {
				article: article ?? seed,
				effects: [],
				writes: [],
			};
		};

		const { upsertAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await upsertAndPersist(upsertTransition, { url: URL, input: undefined });

		assert.equal(seen.length, 1);
		assert.equal(seen[0], seed);
		assert.deepEqual(saved, []); /* writes empty → save skipped */
	});

	it("threads the upsert transition's name through to store.save", async () => {
		const { store, saved } = createFakeStore([]);
		const dispatchEffect: DispatchEffect = async () => {};
		const stubArticle: Article = {
			url: URL,
			metadata: { title: "X", siteName: "x", excerpt: "", wordCount: 0 },
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			estimatedReadTime: 1,
			crawl: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
			summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
			summaryAutoHeal: { attempts: 0 },
		};
		function namedUpsertTransition(): {
			article: Article;
			effects: readonly Effect[];
			writes: readonly AggregateField[];
		} {
			return {
				article: stubArticle,
				effects: [],
				writes: ["metadata"],
			};
		}

		const { upsertAndPersist } = initTransitionAndPersist({
			store,
			dispatchEffect,
		});

		await upsertAndPersist(namedUpsertTransition, { url: URL, input: undefined });

		assert.equal(saved.length, 1);
		assert.equal(saved[0]?.transitionName, "namedUpsertTransition");
	});
});
