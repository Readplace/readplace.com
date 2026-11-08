import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { CanonicalImageUrlSchema } from "../canonical-image-url";
import { CanonicalPublishedOnSchema } from "../canonical-published-on";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";
import { promoteTier } from "./promote-tier";
import { recrawlPromoteTier } from "./recrawl-promote-tier";
import { refreshContent } from "./refresh-content";

const NOW = "2026-11-06T07:37:03.867Z";
const EARLIER = "2026-11-06T07:37:01.856Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const METADATA = {
	title: "Numbers to know",
	siteName: "Example",
	excerpt: "Excerpt",
	wordCount: 900,
	imageUrl: CanonicalImageUrlSchema.parse("https://example.com/image.jpg"),
	publishedOn: CanonicalPublishedOnSchema.parse("2026-10-01"),
};

const SUMMARY_STATES: Article["summary"][] = [
	{ kind: "ready", summary: "Summary", excerpt: "Excerpt" },
	{ kind: "pending", pendingSince: EARLIER },
	{ kind: "skipped", reason: "content-too-short" },
	{ kind: "failed", reason: { kind: "crawl-failed" } },
];

function buildArticle(params: { summary: Article["summary"]; canonicalContentHash: string }): Article {
	return {
		url: "https://example.com/numbers-to-know",
		metadata: { title: "Old", siteName: "Example", excerpt: "Old", wordCount: 100 },
		freshness: { contentFetchedAt: "2026-11-01T00:00:00.000Z", canonicalContentHash: params.canonicalContentHash },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: params.summary,
		summaryAutoHeal: { attempts: 0 },
	};
}

type TransitionResult = { article: Article; effects: readonly Effect[]; writes: readonly AggregateField[] };

const PUBLISHERS: { name: string; run: (article: Article, canonicalContentHash: string) => TransitionResult[] }[] = [
	{
		name: "promoteTier",
		run: (article, canonicalContentHash) =>
			[true, false].map((canonicalChanged) =>
				promoteTier(article, {
					tier: "tier-0",
					display: { kind: "candidate" },
					metadata: METADATA,
					estimatedReadTime: 4,
					contentFetchedAt: NOW,
					now: NOW,
					canonicalChanged,
					canonicalContentHash,
				}),
			),
	},
	{
		name: "refreshContent",
		run: (article, canonicalContentHash) => [
			refreshContent(article, {
				display: { kind: "candidate" },
				metadata: METADATA,
				freshness: { contentFetchedAt: NOW },
				estimatedReadTime: 4,
				now: NOW,
				canonicalContentHash,
			}),
		],
	},
	{
		name: "recrawlPromoteTier",
		run: (article, canonicalContentHash) => [
			recrawlPromoteTier(article, {
				winnerTier: "tier-1",
				metadata: METADATA,
				estimatedReadTime: 4,
				contentFetchedAt: NOW,
				now: NOW,
				canonicalContentHash,
			}),
		],
	},
];

describe("every publisher of CanonicalContentChanged persists a pending summary in the same save", () => {
	for (const publisher of PUBLISHERS) {
		for (const summary of SUMMARY_STATES) {
			for (const nextHash of [HASH_A, HASH_B]) {
				it(`${publisher.name} from a ${summary.kind} summary with ${nextHash === HASH_A ? "unchanged" : "changed"} content`, () => {
					const results = publisher.run(buildArticle({ summary, canonicalContentHash: HASH_A }), nextHash);

					for (const result of results) {
						if (!result.effects.some((effect) => effect.kind === "publish-canonical-content-changed")) continue;
						assert.equal(result.article.summary.kind, "pending");
						assert.ok(result.writes.includes("summary"));
					}
				});
			}
		}
	}

	it("each publisher announces a change on changed content, so the invariant above is exercised", () => {
		for (const publisher of PUBLISHERS) {
			const results = publisher.run(
				buildArticle({ summary: { kind: "ready", summary: "Summary", excerpt: "Excerpt" }, canonicalContentHash: HASH_A }),
				HASH_B,
			);
			assert.ok(
				results.every((result) => result.effects.some((effect) => effect.kind === "publish-canonical-content-changed")),
				publisher.name,
			);
		}
	});
});
