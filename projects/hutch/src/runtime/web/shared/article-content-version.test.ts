import assert from "node:assert/strict";
import { computeArticleContentVersion, type ArticleContentVersionInput } from "./article-content-version";

function baseInput(overrides?: Partial<ArticleContentVersionInput>): ArticleContentVersionInput {
	return {
		article: {
			metadata: {
				title: "A Title",
				siteName: "example.com",
				excerpt: "An excerpt",
				wordCount: 500,
				imageUrl: "https://cdn.example.com/img.jpg",
			},
			contentFetchedAt: new Date("2026-03-26T14:32:00.000Z"),
		},
		crawl: { status: "ready" },
		summary: { status: "ready", summary: "TL;DR", excerpt: "short" },
		...overrides,
	};
}

function withMetadata(
	metadata: ArticleContentVersionInput["article"]["metadata"],
): ArticleContentVersionInput {
	return baseInput({ article: { metadata, contentFetchedAt: undefined } });
}

describe("computeArticleContentVersion", () => {
	it("returns a stable 16-hex token for identical input", () => {
		const token = computeArticleContentVersion(baseInput());
		assert.match(token, /^[0-9a-f]{16}$/);
		assert.equal(token, computeArticleContentVersion(baseInput()));
	});

	it("changes when the title changes", () => {
		const a = withMetadata({ title: "One", siteName: "s.com", excerpt: "e", wordCount: 1 });
		const b = withMetadata({ title: "Two", siteName: "s.com", excerpt: "e", wordCount: 1 });
		assert.notEqual(computeArticleContentVersion(a), computeArticleContentVersion(b));
	});

	it("changes when the excerpt changes", () => {
		const a = withMetadata({ title: "T", siteName: "s.com", excerpt: "one", wordCount: 1 });
		const b = withMetadata({ title: "T", siteName: "s.com", excerpt: "two", wordCount: 1 });
		assert.notEqual(computeArticleContentVersion(a), computeArticleContentVersion(b));
	});

	it("changes when the siteName changes", () => {
		const a = withMetadata({ title: "T", siteName: "a.com", excerpt: "e", wordCount: 1 });
		const b = withMetadata({ title: "T", siteName: "b.com", excerpt: "e", wordCount: 1 });
		assert.notEqual(computeArticleContentVersion(a), computeArticleContentVersion(b));
	});

	it("changes when the word count changes", () => {
		const a = withMetadata({ title: "T", siteName: "s.com", excerpt: "e", wordCount: 1 });
		const b = withMetadata({ title: "T", siteName: "s.com", excerpt: "e", wordCount: 2 });
		assert.notEqual(computeArticleContentVersion(a), computeArticleContentVersion(b));
	});

	it("changes when imageUrl is filled in where there was none", () => {
		const without = withMetadata({ title: "T", siteName: "s.com", excerpt: "e", wordCount: 1 });
		const withImage = withMetadata({
			title: "T",
			siteName: "s.com",
			excerpt: "e",
			wordCount: 1,
			imageUrl: "https://cdn.example.com/i.jpg",
		});
		assert.notEqual(computeArticleContentVersion(without), computeArticleContentVersion(withImage));
	});

	it("changes when the crawl status changes, and treats an absent crawl distinctly", () => {
		const pending = computeArticleContentVersion(baseInput({ crawl: { status: "pending" } }));
		const ready = computeArticleContentVersion(baseInput({ crawl: { status: "ready" } }));
		const absent = computeArticleContentVersion(baseInput({ crawl: undefined }));
		assert.notEqual(pending, ready);
		assert.notEqual(ready, absent);
	});

	it("changes with a failed crawl reason and an unsupported crawl reason", () => {
		const failedA = computeArticleContentVersion(baseInput({ crawl: { status: "failed", reason: "a" } }));
		const failedB = computeArticleContentVersion(baseInput({ crawl: { status: "failed", reason: "b" } }));
		const unsupported = computeArticleContentVersion(
			baseInput({ crawl: { status: "unsupported", reason: "a" } }),
		);
		assert.notEqual(failedA, failedB);
		assert.notEqual(failedA, unsupported);
	});

	it("changes when the summary status changes, and treats an absent summary distinctly", () => {
		const pending = computeArticleContentVersion(baseInput({ summary: { status: "pending" } }));
		const absent = computeArticleContentVersion(baseInput({ summary: undefined }));
		assert.notEqual(pending, absent);
	});

	it("changes when the summary text changes while status stays ready", () => {
		const a = computeArticleContentVersion(baseInput({ summary: { status: "ready", summary: "one" } }));
		const b = computeArticleContentVersion(baseInput({ summary: { status: "ready", summary: "two" } }));
		assert.notEqual(a, b);
	});

	it("changes when the summary excerpt appears where there was none", () => {
		const without = computeArticleContentVersion(baseInput({ summary: { status: "ready", summary: "x" } }));
		const withExcerpt = computeArticleContentVersion(
			baseInput({ summary: { status: "ready", summary: "x", excerpt: "short" } }),
		);
		assert.notEqual(without, withExcerpt);
	});

	it("changes with a failed summary reason and a skipped summary reason", () => {
		const failed = computeArticleContentVersion(baseInput({ summary: { status: "failed", reason: "boom" } }));
		const skippedWith = computeArticleContentVersion(
			baseInput({ summary: { status: "skipped", reason: "too-short" } }),
		);
		const skippedWithout = computeArticleContentVersion(baseInput({ summary: { status: "skipped" } }));
		assert.notEqual(failed, skippedWith);
		assert.notEqual(skippedWith, skippedWithout);
	});

	it("changes when contentFetchedAt changes even if every metadata field is identical", () => {
		const metadata = { title: "T", siteName: "s.com", excerpt: "e", wordCount: 1 } as const;
		const earlier = baseInput({
			article: { metadata: { ...metadata }, contentFetchedAt: new Date("2026-01-01T00:00:00.000Z") },
			crawl: { status: "ready" },
			summary: undefined,
		});
		const later = baseInput({
			article: { metadata: { ...metadata }, contentFetchedAt: new Date("2026-02-01T00:00:00.000Z") },
			crawl: { status: "ready" },
			summary: undefined,
		});
		assert.notEqual(computeArticleContentVersion(earlier), computeArticleContentVersion(later));
	});

	it("is stable for a legacy article that has no contentFetchedAt", () => {
		const legacy = baseInput({
			article: {
				metadata: { title: "T", siteName: "s.com", excerpt: "e", wordCount: 1 },
				contentFetchedAt: undefined,
			},
		});
		assert.equal(computeArticleContentVersion(legacy), computeArticleContentVersion(legacy));
	});
});
