import type { CrawlArticle } from "./crawl-article.types";
import { initFetchPinnedCrawl } from "./fetch-pinned-crawl";

function captureCrawl(): { crawlArticle: CrawlArticle; urls: string[] } {
	const urls: string[] = [];
	const crawlArticle: CrawlArticle = async (params) => {
		urls.push(params.url);
		return { status: "failed" };
	};
	return { crawlArticle, urls };
}

describe("initFetchPinnedCrawl", () => {
	it("fetches the adopted terminal instead of the identity URL", async () => {
		const { crawlArticle, urls } = captureCrawl();
		const pinned = initFetchPinnedCrawl({
			crawlArticle,
			findAdoptedFetchUrl: async () => "https://nytimes.com/real-article",
		});

		await pinned({ url: "https://evil.com/x" });

		expect(urls).toEqual(["https://nytimes.com/real-article"]);
	});

	it("fetches the identity URL when the article was never adopted", async () => {
		const { crawlArticle, urls } = captureCrawl();
		const pinned = initFetchPinnedCrawl({
			crawlArticle,
			findAdoptedFetchUrl: async () => undefined,
		});

		await pinned({ url: "https://site.com/page", etag: '"v1"' });

		expect(urls).toEqual(["https://site.com/page"]);
	});

	it("preserves the other crawl params (conditional headers, thumbnail opt-in)", async () => {
		const seen: Parameters<CrawlArticle>[0][] = [];
		const crawlArticle: CrawlArticle = async (params) => {
			seen.push(params);
			return { status: "not-modified" };
		};
		const pinned = initFetchPinnedCrawl({ crawlArticle, findAdoptedFetchUrl: async () => undefined });

		await pinned({ url: "https://site.com/page", etag: '"v1"', fetchThumbnail: true });

		expect(seen[0]).toEqual({ url: "https://site.com/page", etag: '"v1"', fetchThumbnail: true });
	});
});
