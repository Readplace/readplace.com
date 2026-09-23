import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { requestRecrawl } from "./request-recrawl";

const NOW = "2026-05-13T12:00:00.000Z";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/article",
		metadata: {
			title: "Existing Title",
			siteName: "Example",
			excerpt: "Existing excerpt",
			wordCount: 800,
			imageUrl: "https://cdn.example.com/hero.jpg",
		},
		freshness: {
			etag: '"existing-etag"',
			lastModified: "2026-05-10T00:00:00.000Z",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
		},
		estimatedReadTime: 5,
		crawl: { kind: "ready" },
		summary: { kind: "ready", summary: "Existing summary" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("requestRecrawl", () => {
	it("sets contentFetchedAt to the epoch so the next stale-check treats the row as expired", () => {
		const { article } = requestRecrawl(buildArticle(), { now: NOW });

		assert.equal(article.freshness.contentFetchedAt, "1970-01-01T00:00:00.000Z");
	});

	it("flips crawl to pending with the supplied timestamp so the queue UI shows the operator's recrawl in progress", () => {
		const { article } = requestRecrawl(buildArticle(), { now: NOW });

		assert.deepEqual(article.crawl, { kind: "pending", pendingSince: NOW });
	});

	it("flips summary to pending with the supplied timestamp so the summary panel re-runs after the content lands", () => {
		const { article } = requestRecrawl(buildArticle(), { now: NOW });

		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("clears summaryAutoHeal so a previously-exhausted summary gets a fresh retry budget on the operator's recrawl", () => {
		const before = buildArticle({
			summaryAutoHeal: {
				attempts: 3,
				lastAttemptAt: "2026-05-12T00:00:00.000Z",
			},
		});

		const { article } = requestRecrawl(before, { now: NOW });

		assert.deepEqual(article.summaryAutoHeal, { attempts: 0 });
	});

	it("preserves metadata so the queue card doesn't blank between operator click and crawl completion", () => {
		const before = buildArticle();

		const { article } = requestRecrawl(before, { now: NOW });

		assert.deepEqual(article.metadata, before.metadata);
	});

	it("preserves etag and lastModified so the conditional fetch still short-circuits if the origin returns 304", () => {
		const before = buildArticle();

		const { article } = requestRecrawl(before, { now: NOW });

		assert.equal(article.freshness.etag, '"existing-etag"');
		assert.equal(article.freshness.lastModified, "2026-05-10T00:00:00.000Z");
	});

	it("dispatches a single dispatch-submit-link effect carrying the article's url so the standard pipeline picks it up", () => {
		const { effects } = requestRecrawl(
			buildArticle({ url: "https://example.com/post" }),
			{ now: NOW },
		);

		assert.deepEqual(effects, [
			{ kind: "dispatch-submit-link", url: "https://example.com/post" },
		]);
	});

	it("declares writes for freshness, crawl, summary, summaryAutoHeal so metadata is not clobbered", () => {
		const { writes } = requestRecrawl(buildArticle(), { now: NOW });

		assert.deepEqual([...writes].sort(), [
			"crawl",
			"freshness",
			"summary",
			"summaryAutoHeal",
		]);
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		requestRecrawl(before, { now: NOW });

		assert.deepEqual(before, snapshot);
	});
});
