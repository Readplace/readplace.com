import { noopLogger } from "@packages/hutch-logger";
import { initSelectRelatedArticles } from "./related-articles-selector";
import assert from "node:assert/strict";
import { articleDestinationUrl } from "@packages/domain/article";
import type {
	RelatedArticleLink,
	RelatedCandidate,
} from "@packages/provider-contracts/related-articles";
import { initSelectAgreedPicks } from "./agreed-picks";
import type {
	SelectRelatedArticlesParams,
	SelectRelatedResult,
} from "./related-articles-selector";

const candidate = (name: string): RelatedCandidate => ({
	url: `https://example.com/${name}`,
	destinationUrl: articleDestinationUrl({
		url: `https://example.com/${name}`,
		displayUrl: undefined,
	}),
	title: name,
	siteName: "Example",
	description: name,
});
const params: SelectRelatedArticlesParams = {
	target: candidate("target"),
	unreadCandidates: [candidate("a"), candidate("b")],
	readCandidates: [candidate("c")],
};
const pick = (name: string, reason = name): RelatedArticleLink => ({
	url: candidate(name).url,
	reason,
});
const ready = (
	related: RelatedArticleLink[],
	tokens = 10,
): SelectRelatedResult => ({
	kind: "ready",
	related,
	inputTokens: tokens,
	outputTokens: 2,
	droppedNoSharedWord: 0,
	droppedReasonNotAboutPick: 0,
	samples: [
		{
			inputTokens: tokens,
			outputTokens: 2,
			durationMs: 7,
			cacheHitInputTokens: 8,
			cacheMissInputTokens: 2,
		},
	],
});
function selection(results: SelectRelatedResult[]) {
	const calls: SelectRelatedArticlesParams[] = [];
	const select = initSelectAgreedPicks({
		selectRelatedArticles: async (p) => {
			calls.push(p);
			const result = results[calls.length - 1];
			assert(result);
			return result;
		},
	}).selectRelatedArticles;
	return { select, calls };
}

describe("agreed Next-read picks", () => {
	it.each<SelectRelatedResult>([
		{ kind: "no-text-block" },
		{ kind: "shared-boilerplate" },
		{ kind: "no-shared-words", bestScore: 0, candidateCount: 1 },
	])("passes through a first-call skip without repeating", async (result) => {
		const { select, calls } = selection([result]);
		expect(await select(params)).toBe(result);
		expect(calls).toHaveLength(1);
	});
	it("does not repeat when grounding leaves no valid first picks", async () => {
		const { select, calls } = selection([ready([])]);
		expect(await select(params)).toMatchObject({
			related: [],
			agreement: { agreed: 0, firstOnly: 0, laterOnly: 0 },
			samples: [{ inputTokens: 10 }],
		});
		expect(calls).toHaveLength(1);
	});
	it("intersects valid URLs, keeps first tokens, and collects both samples", async () => {
		const { select, calls } = selection([
			ready([pick("a"), pick("b")]),
			ready([pick("b"), pick("c")], 20),
		]);
		expect(await select(params)).toMatchObject({
			related: [pick("b")],
			inputTokens: 10,
			outputTokens: 2,
			samples: [{ inputTokens: 10 }, { inputTokens: 20 }],
			agreement: { agreed: 1, firstOnly: 1, laterOnly: 1 },
		});
		expect(calls).toEqual([params, params]);
		expect(calls[0]).toBe(calls[1]);
	});
	it("orders unread before read, then mean rank, with first rank breaking ties", async () => {
		const { select } = selection([
			ready([pick("c"), pick("b", "first b"), pick("a", "first a")]),
			ready([pick("a", "later a"), pick("c"), pick("b", "later b")]),
		]);
		expect(await select(params)).toMatchObject({
			related: [pick("a", "later a"), pick("b", "first b"), pick("c")],
		});
	});
	it("uses first rank to break equal mean ranks and first reason on equal ranks", async () => {
		const { select } = selection([
			ready([pick("b", "first b"), pick("a", "first a")]),
			ready([pick("a", "later a"), pick("b", "later b")]),
		]);
		expect(await select(params)).toMatchObject({
			related: [pick("b", "first b"), pick("a", "later a")],
		});
	});
	it("accepts a valid empty repeat as empty agreement", async () => {
		const { select } = selection([ready([pick("a")]), ready([])]);
		expect(await select(params)).toMatchObject({
			related: [],
			agreement: { agreed: 0, firstOnly: 1, laterOnly: 0 },
		});
	});
	it("rejects a repeat without a text response", async () => {
		const { select } = selection([
			ready([pick("a")]),
			{ kind: "no-text-block" },
		]);
		await expect(select(params)).rejects.toThrow(
			"repeat must return a selection",
		);
	});
	it("propagates a failed repeat instead of accepting the first picks", async () => {
		let calls = 0;
		const { selectRelatedArticles } = initSelectAgreedPicks({
			selectRelatedArticles: async () => {
				if (++calls === 2) throw new Error("empty DeepSeek content");
				return ready([pick("a")]);
			},
		});
		await expect(selectRelatedArticles(params)).rejects.toThrow(
			"empty DeepSeek content",
		);
	});
});

it("repeats identical grounded requests, preserves clipped reasons and records each call", async () => {
	const requests: string[] = [];
	let clock = 0;
	const { selectRelatedArticles } = initSelectAgreedPicks(
		initSelectRelatedArticles({
			logger: noopLogger,
			nowMs: () => {
				clock += 7;
				return clock;
			},
			createMessage: async (request) => {
				requests.push(JSON.stringify(request));
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								related: [
									{ index: 0, reason: `Queues ${"decay ".repeat(30)}` },
									{ index: 1, reason: "astronomy" },
								],
							}),
						},
					],
					usage: {
						input_tokens: 100,
						output_tokens: 20,
						cache_hit_input_tokens: 90,
						cache_miss_input_tokens: 10,
					},
				};
			},
		}),
	);
	const result = await selectRelatedArticles({
		...params,
		target: { ...params.target, title: "Queues decay" },
		unreadCandidates: [
			{ ...candidate("a"), title: "Queues decay" },
			candidate("astronomy"),
		],
	});
	assert.equal(result.kind, "ready");
	expect(requests).toHaveLength(2);
	expect(requests[0]).toBe(requests[1]);
	expect(result.related).toEqual([
		{ url: candidate("a").url, reason: `Queues ${"decay ".repeat(17)}decay…` },
	]);
	expect(result.samples).toEqual([
		{
			inputTokens: 100,
			outputTokens: 20,
			durationMs: 7,
			cacheHitInputTokens: 90,
			cacheMissInputTokens: 10,
		},
		{
			inputTokens: 100,
			outputTokens: 20,
			durationMs: 7,
			cacheHitInputTokens: 90,
			cacheMissInputTokens: 10,
		},
	]);
	expect(result.inputTokens).toBe(100);
});

it("keeps call one's reason on equal ranks and past reads after unread picks", async () => {
	const { select } = selection([
		ready([pick("a", "first a"), pick("c", "first c")]),
		ready([pick("a", "later a"), pick("c", "later c")]),
	]);
	expect(await select(params)).toMatchObject({ related: [pick("a", "first a"), pick("c", "first c")] });
});

it("waits for call one to resolve before dispatching the repeat", async () => {
	let release: (result: SelectRelatedResult) => void = () => {};
	const pending = new Promise<SelectRelatedResult>(resolve => { release = resolve; });
	let calls = 0;
	const { selectRelatedArticles } = initSelectAgreedPicks({ selectRelatedArticles: async () => {
		calls += 1;
		return calls === 1 ? pending : ready([pick("a")]);
	} });
	const result = selectRelatedArticles(params);
	expect(calls).toBe(1);
	release(ready([pick("a")]));
	expect(await result).toMatchObject({ related: [pick("a")] });
	expect(calls).toBe(2);
});
