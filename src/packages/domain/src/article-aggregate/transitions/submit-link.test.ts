import assert from "node:assert/strict";
import type { Article } from "../article.types";
import { submitLink } from "./submit-link";

const URL = "https://example.com/article";
const NOW = "2026-05-13T10:00:00.000Z";

function buildArticle(overrides: Partial<Article> = {}): Article {
	return {
		url: URL,
		metadata: {
			title: "Title",
			siteName: "Example",
			excerpt: "Excerpt",
			wordCount: 100,
		},
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: { kind: "ready", summary: "S" },
		summaryAutoHeal: { attempts: 0 },
		...overrides,
	};
}

describe("submitLink", () => {
	describe("first save (no existing article)", () => {
		it("synthesises a hostname-only pending stub so the queue card has metadata before the worker fetches", () => {
			const { article } = submitLink(undefined, { url: URL, now: NOW });

			assert.equal(article.url, URL);
			assert.equal(article.metadata.title, "Article from example.com");
			assert.equal(article.metadata.siteName, "example.com");
			assert.equal(article.metadata.excerpt, "Saved from example.com.");
			assert.equal(article.metadata.wordCount, 0);
			assert.equal(article.freshness.contentFetchedAt, NOW);
		});

		it("sets crawl and summary to pending with pendingSince=now", () => {
			const { article } = submitLink(undefined, { url: URL, now: NOW });

			assert.deepEqual(article.crawl, { kind: "pending", pendingSince: NOW });
			assert.deepEqual(article.summary, { kind: "pending", pendingSince: NOW });
		});

		it("initialises summaryAutoHeal at attempts=0", () => {
			const { article } = submitLink(undefined, { url: URL, now: NOW });

			assert.deepEqual(article.summaryAutoHeal, { attempts: 0 });
		});

		it("declares writes for metadata, freshness, crawl, summary so the row is fully populated on first save", () => {
			const { writes } = submitLink(undefined, { url: URL, now: NOW });

			assert.deepEqual([...writes].sort(), [
				"crawl",
				"freshness",
				"metadata",
				"summary",
			]);
		});

		it("dispatches a SubmitLinkCommand effect carrying the URL (no userId, no rawHtml on anonymous saves)", () => {
			const { effects } = submitLink(undefined, { url: URL, now: NOW });

			assert.deepEqual(effects, [
				{
					kind: "dispatch-submit-link",
					url: URL,
					userId: undefined,
					rawHtml: undefined,
				},
			]);
		});

		it("passes userId through on authenticated saves", () => {
			const { effects } = submitLink(undefined, {
				url: URL,
				userId: "user-1",
				now: NOW,
			});

			assert.deepEqual(effects, [
				{
					kind: "dispatch-submit-link",
					url: URL,
					userId: "user-1",
					rawHtml: undefined,
				},
			]);
		});

		it("passes rawHtml through on extension uploads", () => {
			const html = "<html><body>raw</body></html>";
			const { effects } = submitLink(undefined, {
				url: URL,
				userId: "user-1",
				rawHtml: html,
				now: NOW,
			});

			assert.deepEqual(effects, [
				{
					kind: "dispatch-submit-link",
					url: URL,
					userId: "user-1",
					rawHtml: html,
				},
			]);
		});
	});

	describe("re-save on an in-flight pending row", () => {
		it("is an idempotent no-op on the row (writes stay empty so the in-flight pendingSince is preserved)", () => {
			const before = buildArticle({
				crawl: { kind: "pending", pendingSince: "2026-05-13T09:00:00.000Z" },
			});

			const { article, writes } = submitLink(before, { url: URL, now: NOW });

			assert.equal(article, before);
			assert.deepEqual([...writes], []);
		});

		it("still re-dispatches SubmitLinkCommand so a stuck pending gets re-triggered", () => {
			const before = buildArticle({
				crawl: { kind: "pending", pendingSince: "2026-05-13T09:00:00.000Z" },
			});

			const { effects } = submitLink(before, {
				url: URL,
				userId: "user-1",
				now: NOW,
			});

			assert.equal(effects.length, 1);
			const effect = effects[0];
			assert.equal(effect?.kind, "dispatch-submit-link");
		});
	});

	describe("re-save on a terminal row", () => {
		it("does not flip a ready row back to pending (writes stay empty)", () => {
			const before = buildArticle({
				crawl: { kind: "ready" },
				summary: { kind: "ready", summary: "S" },
			});

			const { article, writes } = submitLink(before, { url: URL, now: NOW });

			assert.equal(article, before);
			assert.deepEqual([...writes], []);
		});

		it("does not flip a failed crawl row back to pending — operators use requestRecrawl for that", () => {
			const before = buildArticle({
				crawl: { kind: "failed", reason: { kind: "fetch-failed" } },
			});

			const { article, writes } = submitLink(before, { url: URL, now: NOW });

			assert.equal(article, before);
			assert.deepEqual([...writes], []);
		});

		it("does not flip an unsupported crawl row back to pending — operators use requestRecrawl for that", () => {
			const before = buildArticle({
				crawl: {
					kind: "unsupported",
					reason: { kind: "paywall" },
				},
			});

			const { article, writes } = submitLink(before, { url: URL, now: NOW });

			assert.equal(article, before);
			assert.deepEqual([...writes], []);
		});

		it("still re-dispatches SubmitLinkCommand", () => {
			const before = buildArticle({ crawl: { kind: "ready" } });

			const { effects } = submitLink(before, { url: URL, now: NOW });

			assert.equal(effects.length, 1);
			assert.equal(effects[0]?.kind, "dispatch-submit-link");
		});
	});

	it("does not mutate the input article", () => {
		const before = buildArticle();
		const snapshot = JSON.parse(JSON.stringify(before));

		submitLink(before, { url: URL, now: NOW });

		assert.deepEqual(before, snapshot);
	});

	it("exposes its function name so transitionAndPersist can tag the row", () => {
		assert.equal(submitLink.name, "submitLink");
	});
});
