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

describe("initFetchPinnedCrawl — twitter.com identities", () => {
	it("fetches an unpinned twitter.com identity from x.com, looking up its pin under twitter.com", async () => {
		const { crawlArticle, urls } = captureCrawl();
		const lookups: string[] = [];
		const pinned = initFetchPinnedCrawl({
			crawlArticle,
			findAdoptedFetchUrl: async (url) => {
				lookups.push(url);
				return undefined;
			},
		});

		await pinned({ url: "https://twitter.com/jack/status/20?s=20#top" });

		expect(lookups).toEqual(["https://twitter.com/jack/status/20?s=20#top"]);
		expect(urls).toEqual(["https://x.com/jack/status/20?s=20#top"]);
	});

	it("fetches a pin that points at twitter.com from x.com", async () => {
		const { crawlArticle, urls } = captureCrawl();
		const pinned = initFetchPinnedCrawl({
			crawlArticle,
			findAdoptedFetchUrl: async () => "https://twitter.com/jack/status/20",
		});

		await pinned({ url: "https://short.example/abc" });

		expect(urls).toEqual(["https://x.com/jack/status/20"]);
	});

	it("keeps the pin ahead of normalizing the identity", async () => {
		const { crawlArticle, urls } = captureCrawl();
		const pinned = initFetchPinnedCrawl({
			crawlArticle,
			findAdoptedFetchUrl: async () => "https://publisher.example/story",
		});

		await pinned({ url: "https://twitter.com/jack/status/20" });

		expect(urls).toEqual(["https://publisher.example/story"]);
	});

	it("leaves a twitter.com subdomain as it is", async () => {
		const { crawlArticle, urls } = captureCrawl();
		const pinned = initFetchPinnedCrawl({ crawlArticle, findAdoptedFetchUrl: async () => undefined });

		await pinned({ url: "https://mobile.twitter.com/jack/status/20" });

		expect(urls).toEqual(["https://mobile.twitter.com/jack/status/20"]);
	});
});
