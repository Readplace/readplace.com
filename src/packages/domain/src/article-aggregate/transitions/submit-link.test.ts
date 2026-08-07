import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { submitLink } from "./submit-link";

const NOW = "2026-05-13T12:00:00.000Z";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: "https://example.com/article",
		metadata: {
			title: "Title",
			siteName: "Example",
			excerpt: "Excerpt",
			wordCount: 100,
		},
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 5,
		crawl: { kind: "ready" },
		summary: { kind: "ready", summary: "Existing summary" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("submitLink", () => {
	describe("first save (article is undefined)", () => {
		it("synthesises a hostname-only stub so the queue card renders at t=0 before the crawler runs", () => {
			const { article } = submitLink(undefined, {
				url: "https://news.ycombinator.com/item?id=123",
				now: NOW,
			});

			assert.equal(article.url, "https://news.ycombinator.com/item?id=123");
			assert.equal(article.metadata.siteName, "news.ycombinator.com");
			assert.equal(article.metadata.title, "Article from news.ycombinator.com");
			assert.equal(article.metadata.excerpt, "Saved from news.ycombinator.com.");
			assert.equal(article.metadata.wordCount, 0);
		});

		it("sets both axes to pending with the supplied timestamp so the queue progress UI is correctly seeded", () => {
			const { article } = submitLink(undefined, {
				url: "https://example.com/post",
				now: NOW,
			});

			assert.deepEqual(article.crawl, { kind: "pending", pendingSince: NOW });
			assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
		});

		it("seeds freshness with the supplied timestamp so the next stale-check uses a known anchor", () => {
			const { article } = submitLink(undefined, {
				url: "https://example.com/post",
				now: NOW,
			});

			assert.equal(article.freshness.contentFetchedAt, NOW);
		});

		it("zeroes summaryAutoHeal so a fresh row has a full retry budget", () => {
			const { article } = submitLink(undefined, {
				url: "https://example.com/post",
				now: NOW,
			});

			assert.deepEqual(article.summaryAutoHeal, { attempts: 0 });
		});

		it("declares writes for all four axes so the storage adapter persists the synthesised stub atomically", () => {
			const { writes } = submitLink(undefined, {
				url: "https://example.com/post",
				now: NOW,
			});

			assert.deepEqual([...writes].sort(), [
				"crawl",
				"freshness",
				"metadata",
				"summary",
			]);
		});

		it("dispatches a single dispatch-submit-link effect carrying the url", () => {
			const { effects } = submitLink(undefined, {
				url: "https://example.com/post",
				now: NOW,
			});

			assert.deepEqual(effects, [
				{ kind: "dispatch-submit-link", url: "https://example.com/post" },
			]);
		});

		it("passes the submitter through the effect so the submit-link handler can route the save to the authenticated user's library and tag where it came from", () => {
			const { effects } = submitLink(undefined, {
				url: "https://example.com/post",
				submitter: { userId: "user-123", provenance: { kind: "email", senderEmail: "news@example.com" } },
				now: NOW,
			});

			assert.deepEqual(effects, [
				{
					kind: "dispatch-submit-link",
					url: "https://example.com/post",
					submitter: { userId: "user-123", provenance: { kind: "email", senderEmail: "news@example.com" } },
				},
			]);
		});

		it("passes rawHtml through the effect so the submit-link handler can write the tier-0 source for extension uploads", () => {
			const { effects } = submitLink(undefined, {
				url: "https://example.com/post",
				submitter: { userId: "user-123", provenance: { kind: "web" } },
				rawHtml: "<html>captured</html>",
				now: NOW,
			});

			assert.deepEqual(effects, [
				{
					kind: "dispatch-submit-link",
					url: "https://example.com/post",
					submitter: { userId: "user-123", provenance: { kind: "web" } },
					rawHtml: "<html>captured</html>",
				},
			]);
		});
	});

	describe("subsequent save (article exists)", () => {
		it("does not mutate an in-flight pending row so a concurrent crawl is not clobbered", () => {
			const before = buildArticle({
				crawl: { kind: "pending", pendingSince: "2026-05-13T11:50:00.000Z" },
				summary: { kind: "pending", pendingSince: "2026-05-13T11:50:00.000Z" },
			});

			const { article } = submitLink(before, {
				url: before.url,
				now: NOW,
			});

			assert.deepEqual(article, before);
		});

		it("declares an empty writes scope on an in-flight pending row so the storage adapter skips the DDB save entirely", () => {
			const before = buildArticle({
				crawl: { kind: "pending", pendingSince: "2026-05-13T11:50:00.000Z" },
				summary: { kind: "pending", pendingSince: "2026-05-13T11:50:00.000Z" },
			});

			const { writes } = submitLink(before, {
				url: before.url,
				now: NOW,
			});

			assert.deepEqual([...writes], []);
		});

		it("re-dispatches dispatch-submit-link on an in-flight pending row so a stuck crawl gets a fresh trigger", () => {
			const before = buildArticle({
				crawl: { kind: "pending", pendingSince: "2026-05-13T11:50:00.000Z" },
				summary: { kind: "pending", pendingSince: "2026-05-13T11:50:00.000Z" },
			});

			const { effects } = submitLink(before, {
				url: before.url,
				now: NOW,
			});

			assert.deepEqual(effects, [
				{ kind: "dispatch-submit-link", url: before.url },
			]);
		});

		it("leaves a ready row alone — operators flip a terminal row back to pending via requestRecrawl, not submitLink", () => {
			const before = buildArticle({ crawl: { kind: "ready" } });

			const { article, writes } = submitLink(before, {
				url: before.url,
				now: NOW,
			});

			assert.deepEqual(article, before);
			assert.deepEqual([...writes], []);
		});

		it("leaves a failed row alone — operators flip a terminal row back to pending via requestRecrawl, not submitLink", () => {
			const before = buildArticle({
				crawl: { kind: "failed", reason: { kind: "fetch-failed", httpStatus: 503 } },
			});

			const { article, writes } = submitLink(before, {
				url: before.url,
				now: NOW,
			});

			assert.deepEqual(article, before);
			assert.deepEqual([...writes], []);
		});

		it("leaves an unsupported row alone — operators flip a terminal row back to pending via requestRecrawl, not submitLink", () => {
			const before = buildArticle({
				crawl: { kind: "unsupported", reason: { kind: "non-html-content", contentType: "application/pdf" } },
			});

			const { article, writes } = submitLink(before, {
				url: before.url,
				now: NOW,
			});

			assert.deepEqual(article, before);
			assert.deepEqual([...writes], []);
		});
	});

	it("does not mutate the input article (pure function)", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		submitLink(before, { url: before.url, now: NOW });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row for the canary measurement", () => {
		assert.equal(submitLink.name, "submitLink");
	});
});
