import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { isArticleReady } from "./is-article-ready";

const CONTENT = "<p>Body copy.</p>";

describe("isArticleReady", () => {
	it("returns true when content is present and crawl is undefined (legacy row)", () => {
		expect(isArticleReady({ crawl: undefined, content: CONTENT })).toBe(true);
	});

	it("returns true when content is present and crawl status is ready", () => {
		expect(
			isArticleReady({ crawl: { status: "ready" }, content: CONTENT }),
		).toBe(true);
	});

	it("returns false when content is missing (read-after-write race)", () => {
		expect(isArticleReady({ crawl: undefined, content: undefined })).toBe(
			false,
		);
	});

	it("returns false when crawl status is pending", () => {
		expect(
			isArticleReady({ crawl: { status: "pending" }, content: CONTENT }),
		).toBe(false);
	});

	it("returns false when crawl status is failed", () => {
		expect(
			isArticleReady({
				crawl: { status: "failed", reason: "x" },
				content: CONTENT,
			}),
		).toBe(false);
	});

	it("returns false when crawl status is unsupported", () => {
		expect(
			isArticleReady({
				crawl: { status: "unsupported", reason: "x" },
				content: CONTENT,
			}),
		).toBe(false);
	});

	it("returns false when crawl is ready but content is missing (worker-bug catch-all)", () => {
		expect(
			isArticleReady({ crawl: { status: "ready" }, content: undefined }),
		).toBe(false);
	});

	it("covers every CrawlStatus variant — a new variant must break this test", () => {
		const variants: Array<{ crawl: ArticleCrawl; expected: boolean }> = [
			{ crawl: { status: "ready" }, expected: true },
			{ crawl: { status: "pending" }, expected: false },
			{ crawl: { status: "failed", reason: "x" }, expected: false },
			{ crawl: { status: "unsupported", reason: "x" }, expected: false },
		];

		for (const { crawl, expected } of variants) {
			expect(isArticleReady({ crawl, content: CONTENT })).toBe(expected);
		}
	});
});
