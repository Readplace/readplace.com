import type { CrawlArticle, CrawlArticleResult } from "./crawl-article.types";
import { initCaptureFallbackCrawl } from "./fetch-capture-fallback";

const ORIGINAL = "https://dead.example/article";
const CAPTURE = "https://web.archive.org/web/20081203185222/https://dead.example/article";
const FETCHED: CrawlArticleResult = { status: "fetched", html: "<p>capture</p>", bodyHash: "a".repeat(64) };

function scriptedCrawl(byUrl: Record<string, CrawlArticleResult>) {
	const calls: Parameters<CrawlArticle>[0][] = [];
	const crawlArticle: CrawlArticle = async (params) => {
		calls.push(params);
		return byUrl[params.url];
	};
	return { crawlArticle, calls };
}

describe("initCaptureFallbackCrawl", () => {
	it.each<CrawlArticleResult>([
		{ status: "failed" },
		{ status: "not-found", httpStatus: 404 },
		{ status: "blocked", httpStatus: 403 },
	])("crawls the recorded archive capture when the origin answers $status", async (originResult) => {
		const { crawlArticle, calls } = scriptedCrawl({ [ORIGINAL]: originResult, [CAPTURE]: FETCHED });
		const crawl = initCaptureFallbackCrawl({ crawlArticle, findContentSourceUrl: async () => CAPTURE });

		const result = await crawl({ url: ORIGINAL, etag: '"v1"', previousBodyHash: "h".repeat(64), fetchThumbnail: true });

		expect(result).toEqual(FETCHED);
		expect(calls).toEqual([
			{ url: ORIGINAL, etag: '"v1"', previousBodyHash: "h".repeat(64), fetchThumbnail: true },
			{ url: CAPTURE, fetchThumbnail: true, onProgress: undefined },
		]);
	});

	it("returns the origin's failure when the article has no archive capture", async () => {
		const { crawlArticle, calls } = scriptedCrawl({ [ORIGINAL]: { status: "failed" } });
		const crawl = initCaptureFallbackCrawl({ crawlArticle, findContentSourceUrl: async () => undefined });

		expect(await crawl({ url: ORIGINAL })).toEqual({ status: "failed" });
		expect(calls).toHaveLength(1);
	});

	it.each<CrawlArticleResult>([
		FETCHED,
		{ status: "not-modified" },
		{ status: "unsupported", reason: "application/pdf" },
	])("keeps the origin's $status answer without looking for a capture", async (originResult) => {
		const lookups: string[] = [];
		const { crawlArticle, calls } = scriptedCrawl({ [ORIGINAL]: originResult });
		const crawl = initCaptureFallbackCrawl({
			crawlArticle,
			findContentSourceUrl: async (url) => {
				lookups.push(url);
				return CAPTURE;
			},
		});

		expect(await crawl({ url: ORIGINAL })).toEqual(originResult);
		expect(calls).toHaveLength(1);
		expect(lookups).toEqual([]);
	});
});
