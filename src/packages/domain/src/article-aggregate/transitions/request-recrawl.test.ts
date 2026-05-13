import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { requestRecrawl } from "./request-recrawl";

const URL = "https://example.com/article";
const NOW = "2026-05-13T10:00:00.000Z";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: URL,
		metadata: {
			title: "Kept Title",
			siteName: "Example",
			excerpt: "Kept excerpt",
			wordCount: 200,
		},
		freshness: {
			etag: '"kept-etag"',
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
		},
		estimatedReadTime: 3,
		crawl: { kind: "ready" },
		summary: { kind: "ready", summary: "Kept summary" },
		summaryAutoHeal: { attempts: 2, lastAttemptAt: "2026-05-12T00:00:00.000Z" },
		...overrides,
	};
}

describe("requestRecrawl", () => {
	it("writes contentFetchedAt = epoch so the next stale-check treats the row as expired", () => {
		const { article } = requestRecrawl(buildArticle(), { now: NOW });

		assert.equal(article.freshness.contentFetchedAt, new Date(0).toISOString());
	});

	it("resets crawl and summary axes to pending with new pendingSince", () => {
		const { article } = requestRecrawl(buildArticle(), { now: NOW });

		assert.deepEqual(article.crawl, { kind: "pending", pendingSince: NOW });
		assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
	});

	it("clears summaryAutoHeal so a previously-exhausted summary gets full retry budget", () => {
		const before = buildArticle({
			summaryAutoHeal: { attempts: 3, lastAttemptAt: NOW },
		});

		const { article } = requestRecrawl(before, { now: NOW });

		assert.deepEqual(article.summaryAutoHeal, { attempts: 0 });
	});

	it("dispatches a single dispatch-submit-link effect (the standard refresh path then runs)", () => {
		const { effects } = requestRecrawl(buildArticle(), { now: NOW });

		assert.deepEqual(effects, [{ kind: "dispatch-submit-link", url: URL }]);
	});

	it("preserves metadata so the queue card doesn't blank between operator click and crawl completion", () => {
		const before = buildArticle({
			metadata: {
				title: "kept title",
				siteName: "kept site",
				excerpt: "kept excerpt",
				wordCount: 500,
			},
		});

		const { article } = requestRecrawl(before, { now: NOW });

		assert.deepEqual(article.metadata, before.metadata);
		assert.equal(article.estimatedReadTime, before.estimatedReadTime);
	});

	it("preserves etag / lastModified so a follow-up conditional GET can still 304", () => {
		const before = buildArticle({
			freshness: {
				etag: '"abc"',
				lastModified: "Wed, 13 May 2026 00:00:00 GMT",
				contentFetchedAt: "2026-05-10T12:00:00.000Z",
			},
		});

		const { article } = requestRecrawl(before, { now: NOW });

		assert.equal(article.freshness.etag, '"abc"');
		assert.equal(article.freshness.lastModified, "Wed, 13 May 2026 00:00:00 GMT");
	});

	it("declares writes for freshness, crawl, summary, summaryAutoHeal", () => {
		const { writes } = requestRecrawl(buildArticle(), { now: NOW });

		assert.deepEqual([...writes].sort(), [
			"crawl",
			"freshness",
			"summary",
			"summaryAutoHeal",
		]);
	});

	it("does not mutate the input article", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		requestRecrawl(before, { now: NOW });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row", () => {
		assert.equal(requestRecrawl.name, "requestRecrawl");
	});
});
