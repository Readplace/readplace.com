import assert from "node:assert/strict";
import type { Minutes, SavedArticle } from "@packages/domain/article";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { computeQueueCardEtag, etagMatches } from "./queue-card.etag";

const ARTICLE_URL = "https://example.com/post";

function makeArticle(overrides?: Partial<SavedArticle>): SavedArticle {
	return {
		id: ReaderArticleHashId.from(ARTICLE_URL),
		userId: "user-1" as UserId,
		url: ARTICLE_URL,
		metadata: {
			title: "Test Article",
			siteName: "example.com",
			excerpt: "An excerpt",
			wordCount: 500,
		},
		estimatedReadTime: 3 as Minutes,
		status: "unread",
		savedAt: new Date("2025-06-01T12:00:00Z"),
		...overrides,
	};
}

describe("computeQueueCardEtag", () => {
	it("returns a weak ETag", () => {
		const etag = computeQueueCardEtag({
			article: makeArticle(),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
		});
		assert(etag.startsWith('W/"'));
		assert(etag.endsWith('"'));
	});

	it("is stable across calls with the same input", () => {
		const input = {
			article: makeArticle(),
			crawl: { status: "ready" as const },
			summary: { status: "ready" as const, summary: "TL;DR" },
		};
		expect(computeQueueCardEtag(input)).toBe(computeQueueCardEtag(input));
	});

	it("changes when crawlStatus changes", () => {
		const article = makeArticle();
		const a = computeQueueCardEtag({ article, crawl: { status: "pending" }, summary: undefined });
		const b = computeQueueCardEtag({ article, crawl: { status: "ready" }, summary: undefined });
		expect(a).not.toBe(b);
	});

	it("changes when summaryStatus changes", () => {
		const article = makeArticle();
		const a = computeQueueCardEtag({ article, crawl: { status: "ready" }, summary: { status: "pending" } });
		const b = computeQueueCardEtag({ article, crawl: { status: "ready" }, summary: { status: "ready", summary: "TL;DR" } });
		expect(a).not.toBe(b);
	});

	it("changes when wordCount changes", () => {
		const a = computeQueueCardEtag({
			article: makeArticle({ metadata: { title: "T", siteName: "s.com", excerpt: "e", wordCount: 0 } }),
			crawl: { status: "pending" },
			summary: { status: "pending" },
		});
		const b = computeQueueCardEtag({
			article: makeArticle({ metadata: { title: "T", siteName: "s.com", excerpt: "e", wordCount: 750 } }),
			crawl: { status: "pending" },
			summary: { status: "pending" },
		});
		expect(a).not.toBe(b);
	});

	it("changes when imageUrl is filled in late by the S3 thumbnail copy", () => {
		const without = computeQueueCardEtag({
			article: makeArticle({ metadata: { title: "T", siteName: "s.com", excerpt: "e", wordCount: 500 } }),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
		});
		const withImage = computeQueueCardEtag({
			article: makeArticle({
				metadata: { title: "T", siteName: "s.com", excerpt: "e", wordCount: 500, imageUrl: "https://cdn.example.com/img.jpg" },
			}),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
		});
		expect(without).not.toBe(withImage);
	});

	it("changes when the user-visible status flips between read and unread", () => {
		const unread = computeQueueCardEtag({
			article: makeArticle({ status: "unread" }),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
		});
		const read = computeQueueCardEtag({
			article: makeArticle({ status: "read", readAt: new Date("2025-06-02T00:00:00Z") }),
			crawl: { status: "ready" },
			summary: { status: "ready", summary: "TL;DR" },
		});
		expect(unread).not.toBe(read);
	});
});

describe("etagMatches", () => {
	it("returns false for an undefined If-None-Match header", () => {
		expect(etagMatches(undefined, 'W/"abc"')).toBe(false);
	});

	it("matches an exact single ETag", () => {
		expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true);
	});

	it("matches when the header carries multiple ETags", () => {
		expect(etagMatches('W/"abc", W/"def"', 'W/"def"')).toBe(true);
	});

	it("does not match when no entry equals the ETag", () => {
		expect(etagMatches('W/"abc"', 'W/"xyz"')).toBe(false);
	});
});
