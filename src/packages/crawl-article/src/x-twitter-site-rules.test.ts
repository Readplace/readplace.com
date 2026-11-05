import { HONEST_BOT_HEADERS } from "./crawl-article";
import type { CrawlFetch, CrawlFetchInit } from "./crawl-fetch";
import { initXTwitterSiteRules } from "./x-twitter-site-rules";

const noopLogError = () => {};

function stubCrawlFetch(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return async (url) => handler(url);
}

const okJson = (payload: unknown): Response =>
	new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

describe("xTwitterSiteRules.matches", () => {
	const site = initXTwitterSiteRules({ crawlFetch: stubCrawlFetch(() => new Response()), logError: noopLogError });

	it("matches x.com URLs", () => {
		expect(site.matches({ url: "https://x.com/user/status/123", hostname: "x.com" })).toBe(true);
	});

	it("matches twitter.com URLs", () => {
		expect(site.matches({ url: "https://twitter.com/user/status/123", hostname: "twitter.com" })).toBe(true);
	});

	it("does not match unrelated origins", () => {
		expect(site.matches({ url: "https://example.com/foo", hostname: "example.com" })).toBe(false);
	});
});

describe("xTwitterSiteRules.onCrawl", () => {
	it("returns synthesised content wrapping author name and embed for a 200 oembed response", async () => {
		const oembedPayload = {
			author_name: "Elon Musk",
			html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Test tweet</p></blockquote>\n',
		};
		const site = initXTwitterSiteRules({ crawlFetch: stubCrawlFetch(async () => okJson(oembedPayload)), logError: noopLogError });

		const result = await site.onCrawl({ url: "https://x.com/elonmusk/status/1519480761749016577" });

		expect(result).toEqual({
			kind: "content",
			html: '<html><head><title>Elon Musk</title></head><body><blockquote class="twitter-tweet"><p lang="en" dir="ltr">Test tweet</p></blockquote>\n</body></html>',
		});
	});

	it("uses empty strings when the oembed payload omits author_name and html", async () => {
		const site = initXTwitterSiteRules({ crawlFetch: stubCrawlFetch(async () => okJson({})), logError: noopLogError });

		const result = await site.onCrawl({ url: "https://twitter.com/user/status/123" });

		expect(result).toEqual({ kind: "content", html: "<html><head><title></title></head><body></body></html>" });
	});

	it("fails closed and logs status when oembed responds non-ok", async () => {
		const logError = jest.fn();
		const site = initXTwitterSiteRules({ crawlFetch: stubCrawlFetch(async () => new Response(null, { status: 404 })), logError });

		const result = await site.onCrawl({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed HTTP 404 for https://x.com/user/status/123");
	});

	it("fails closed and logs the error when crawlFetch throws", async () => {
		const networkError = new Error("network down");
		const logError = jest.fn();
		const site = initXTwitterSiteRules({ crawlFetch: async () => { throw networkError; }, logError });

		const result = await site.onCrawl({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed error for https://x.com/user/status/123", networkError);
	});

	it("fails closed and logs an undefined error when crawlFetch rejects with a non-Error value", async () => {
		const logError = jest.fn();
		const site = initXTwitterSiteRules({ crawlFetch: async () => { throw "string error"; }, logError });

		const result = await site.onCrawl({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed error for https://x.com/user/status/123", undefined);
	});

	it("canonicalises the tweet URL — strips query string before calling oembed", async () => {
		let capturedUrl = "";
		const site = initXTwitterSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => { capturedUrl = url; return okJson({ author_name: "", html: "" }); }),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "https://x.com/user/status/123?ref=test" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F123");
	});

	it("canonicalises the tweet URL — strips /video/<n>?s=<n> sub-path that oembed 404s on", async () => {
		let capturedUrl = "";
		const site = initXTwitterSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => { capturedUrl = url; return okJson({ author_name: "", html: "" }); }),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "https://x.com/AnatoliKopadze/status/2057105488165163198/video/1?s=46" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2FAnatoliKopadze%2Fstatus%2F2057105488165163198");
	});

	it("falls back to the raw URL when canonicalisation cannot find a /status/<id> segment", async () => {
		let capturedUrl = "";
		const site = initXTwitterSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => { capturedUrl = url; return okJson({ author_name: "", html: "" }); }),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "https://x.com/user/profile" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fprofile");
	});

	it("falls back to the raw URL when the input cannot be parsed as a URL", async () => {
		let capturedUrl = "";
		const site = initXTwitterSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => { capturedUrl = url; return okJson({ author_name: "", html: "" }); }),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "not a url" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=not%20a%20url");
	});
});

describe("xTwitterSiteRules.onCrawl for X Article cover tweets", () => {
	type RecordedRequest = { url: string; init: CrawlFetchInit };

	const coverTweetUrl = "https://x.com/pmarca/status/2114751107293749731";
	const oembedUrl = "https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fpmarca%2Fstatus%2F2114751107293749731";
	const coverLink = "https://t.co/rv1SShz6q8";
	const authorName = "Marc Andreessen";

	const embedWith = (paragraph: string): string =>
		`<blockquote class="twitter-tweet"><p lang="zxx" dir="ltr">${paragraph}</p>&mdash; Marc Andreessen (@pmarca) <a href="${coverTweetUrl}?ref_src=twsrc%5Etfw">October 26, 2026</a></blockquote>`;
	const tcoAnchor = (url: string): string => `<a href="${url}">${url}</a>`;
	const contentOf = (embed: string) => ({
		kind: "content",
		html: `<html><head><title>${authorName}</title></head><body>${embed}</body></html>`,
	});

	function stubXFetch(deps: {
		oembedHtml: string;
		answerLink: (url: string, init: CrawlFetchInit) => Response;
		requests: RecordedRequest[];
	}): CrawlFetch {
		return async (url, init) => {
			deps.requests.push({ url, init });
			if (url.startsWith("https://publish.twitter.com/oembed")) {
				return okJson({ author_name: authorName, html: deps.oembedHtml });
			}
			return deps.answerLink(url, init);
		};
	}

	const redirectingTo = (hops: Map<string, string>) => (url: string, init: CrawlFetchInit): Response => {
		const toUrl = hops.get(url);
		if (toUrl !== undefined) init.onRedirect?.({ fromUrl: url, toUrl });
		init.signal?.throwIfAborted();
		return new Response("<html>login</html>", { status: 200 });
	};

	const neverFetched = (url: string): Response => {
		throw new Error(`unexpected link fetch: ${url}`);
	};

	async function crawl(deps: { oembedHtml: string; answerLink: (url: string, init: CrawlFetchInit) => Response }) {
		const requests: RecordedRequest[] = [];
		const site = initXTwitterSiteRules({
			crawlFetch: stubXFetch({ ...deps, requests }),
			logError: noopLogError,
		});
		const result = await site.onCrawl({ url: coverTweetUrl });
		return { result, requests, requestedUrls: requests.map((request) => request.url) };
	}

	it("t.co answers a browser user-agent with a 200 meta-refresh page, so the hop sends the bot user-agent", async () => {
		const { result, requests, requestedUrls } = await crawl({
			oembedHtml: embedWith(tcoAnchor(coverLink)),
			answerLink: redirectingTo(new Map([[coverLink, "https://x.com/i/article/2114743948346556416"]])),
		});

		expect(result).toEqual({ kind: "skip" });
		expect(requestedUrls).toEqual([oembedUrl, coverLink]);
		expect(requests[1]?.init.headers?.["user-agent"]).toBe(HONEST_BOT_HEADERS["user-agent"]);
		expect(requests[1]?.init.signal?.aborted).toBe(true);
	});

	it("keeps the oembed content for a media link-only tweet whose links land on other tweets", async () => {
		const firstLink = "https://t.co/aaaaaaaaaa";
		const secondLink = "https://t.co/bbbbbbbbbb";
		const embed = embedWith(`${tcoAnchor(firstLink)} ${tcoAnchor(secondLink)}`);

		const { result, requestedUrls } = await crawl({
			oembedHtml: embed,
			answerLink: redirectingTo(new Map([
				[firstLink, "https://twitter.com/nima_owji/status/2116566623926587522"],
				[secondLink, "https://twitter.com/svpino/status/2116688390263578808/photo/1"],
			])),
		});

		expect(result).toEqual(contentOf(embed));
		expect(requestedUrls).toEqual([oembedUrl, firstLink, secondLink]);
	});

	it("keeps the oembed content for a link-only tweet whose t.co leaves X", async () => {
		const embed = embedWith(tcoAnchor(coverLink));

		const { result, requestedUrls } = await crawl({
			oembedHtml: embed,
			answerLink: redirectingTo(new Map([[coverLink, "https://example.com/post"]])),
		});

		expect(result).toEqual(contentOf(embed));
		expect(requestedUrls).toEqual([oembedUrl, coverLink]);
	});

	it("never follows a link for a plain text tweet", async () => {
		const embed = embedWith("Just setting up my account");

		const { result, requestedUrls } = await crawl({ oembedHtml: embed, answerLink: neverFetched });

		expect(result).toEqual(contentOf(embed));
		expect(requestedUrls).toEqual([oembedUrl]);
	});

	it("never follows a link when the tweet carries text alongside its t.co link", async () => {
		const embed = embedWith(`Read this ${tcoAnchor(coverLink)}`);

		const { result, requestedUrls } = await crawl({ oembedHtml: embed, answerLink: neverFetched });

		expect(result).toEqual(contentOf(embed));
		expect(requestedUrls).toEqual([oembedUrl]);
	});

	it("never follows a link-only tweet's link when it is not on t.co", async () => {
		const embed = embedWith(tcoAnchor("https://example.com/post"));

		const { result, requestedUrls } = await crawl({ oembedHtml: embed, answerLink: neverFetched });

		expect(result).toEqual(contentOf(embed));
		expect(requestedUrls).toEqual([oembedUrl]);
	});

	it("fails open to the oembed content when the t.co fetch throws before any hop", async () => {
		const embed = embedWith(tcoAnchor(coverLink));

		const { result, requestedUrls } = await crawl({
			oembedHtml: embed,
			answerLink: () => {
				throw new Error("network down");
			},
		});

		expect(result).toEqual(contentOf(embed));
		expect(requestedUrls).toEqual([oembedUrl, coverLink]);
	});

	it("fails open to the oembed content when t.co answers 200 with a body and no redirect", async () => {
		const embed = embedWith(tcoAnchor(coverLink));

		const { result } = await crawl({
			oembedHtml: embed,
			answerLink: () => new Response('<noscript><META http-equiv="refresh"></noscript>', { status: 200 }),
		});

		expect(result).toEqual(contentOf(embed));
	});

	it("fails open to the oembed content when t.co answers 200 with no body and no redirect", async () => {
		const embed = embedWith(tcoAnchor(coverLink));

		const { result } = await crawl({
			oembedHtml: embed,
			answerLink: () => new Response(null, { status: 200 }),
		});

		expect(result).toEqual(contentOf(embed));
	});

	it("detects an article cover whose t.co lands on the twitter.com spelling", async () => {
		const { result } = await crawl({
			oembedHtml: embedWith(tcoAnchor(coverLink)),
			answerLink: redirectingTo(new Map([[coverLink, "https://twitter.com/i/article/1"]])),
		});

		expect(result).toEqual({ kind: "skip" });
	});
});
