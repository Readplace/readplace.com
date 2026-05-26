import type { CrawlFetch } from "./crawl-fetch";
import { initFetchRedditViaOembed, isRedditUrl } from "./reddit-oembed";

const noopLogError = () => {};

function stubCrawlFetch(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return async (url) => handler(url);
}

describe("isRedditUrl", () => {
	it("matches www.reddit.com URLs", () => {
		expect(isRedditUrl("https://www.reddit.com/r/javascript/comments/1tlsqd1/title/")).toBe(true);
	});

	it("matches old.reddit.com URLs", () => {
		expect(isRedditUrl("https://old.reddit.com/r/javascript/comments/1tlsqd1/title/")).toBe(true);
	});

	it.each(["m.reddit.com", "np.reddit.com", "reddit.com"])(
		"matches %s URLs",
		(host) => {
			expect(isRedditUrl(`https://${host}/r/javascript/comments/1tlsqd1/title/`)).toBe(true);
		},
	);

	it("does not match unrelated origins", () => {
		expect(isRedditUrl("https://example.com/foo")).toBe(false);
	});

	it("returns false for malformed URLs", () => {
		expect(isRedditUrl("not a url")).toBe(false);
	});
});

describe("initFetchRedditViaOembed", () => {
	it("returns synthesised HTML wrapping title, author, and embed for a 200 oembed response", async () => {
		const crawlFetch = stubCrawlFetch(async () =>
			new Response(JSON.stringify({
				title: "You might not need the repository pattern",
				author_name: "jayfreestone",
				html: '<blockquote class="reddit-embed-bq">Post content</blockquote>',
			}), { status: 200, headers: { "content-type": "application/json" } }),
		);
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError: noopLogError });

		const result = await fetchReddit({ url: "https://www.reddit.com/r/javascript/comments/1tlsqd1/title/" });

		expect(result).toEqual({
			status: "fetched",
			html: '<html><head><title>You might not need the repository pattern</title></head><body><p>by jayfreestone</p><blockquote class="reddit-embed-bq">Post content</blockquote></body></html>',
		});
	});

	it("uses empty strings when the oembed payload omits title, author_name, and html", async () => {
		const crawlFetch = stubCrawlFetch(async () =>
			new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
		);
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError: noopLogError });

		const result = await fetchReddit({ url: "https://www.reddit.com/r/test/comments/abc123/title/" });

		expect(result).toEqual({
			status: "fetched",
			html: "<html><head><title></title></head><body><p>by </p></body></html>",
		});
	});

	it("escapes HTML entities in title and author_name", async () => {
		const crawlFetch = stubCrawlFetch(async () =>
			new Response(JSON.stringify({
				title: 'Title with <script> & "quotes"',
				author_name: "user<b>bold</b>",
				html: "<blockquote>ok</blockquote>",
			}), { status: 200, headers: { "content-type": "application/json" } }),
		);
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError: noopLogError });

		const result = await fetchReddit({ url: "https://www.reddit.com/r/test/comments/abc123/title/" });

		expect(result).toEqual({
			status: "fetched",
			html: '<html><head><title>Title with &lt;script&gt; &amp; &quot;quotes&quot;</title></head><body><p>by user&lt;b&gt;bold&lt;/b&gt;</p><blockquote>ok</blockquote></body></html>',
		});
	});

	it("returns 'failed' and logs status when oembed responds non-ok", async () => {
		const crawlFetch = stubCrawlFetch(async () => new Response(null, { status: 404 }));
		const logError = jest.fn();
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError });

		const result = await fetchReddit({ url: "https://www.reddit.com/r/test/comments/abc123/title/" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] Reddit oembed HTTP 404 for https://www.reddit.com/r/test/comments/abc123/title/",
		);
	});

	it("returns 'failed' and logs the error when crawlFetch throws", async () => {
		const networkError = new Error("network down");
		const crawlFetch: CrawlFetch = async () => { throw networkError; };
		const logError = jest.fn();
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError });

		const result = await fetchReddit({ url: "https://www.reddit.com/r/test/comments/abc123/title/" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] Reddit oembed error for https://www.reddit.com/r/test/comments/abc123/title/",
			networkError,
		);
	});

	it("returns 'failed' and logs undefined when crawlFetch rejects with a non-Error value", async () => {
		const crawlFetch: CrawlFetch = async () => { throw "string error"; };
		const logError = jest.fn();
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError });

		const result = await fetchReddit({ url: "https://www.reddit.com/r/test/comments/abc123/title/" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] Reddit oembed error for https://www.reddit.com/r/test/comments/abc123/title/",
			undefined,
		);
	});

	it("normalises old.reddit.com to www.reddit.com in the oembed request URL", async () => {
		let capturedUrl = "";
		const crawlFetch = stubCrawlFetch(async (url) => {
			capturedUrl = url;
			return new Response(JSON.stringify({ title: "", author_name: "", html: "" }), {
				status: 200, headers: { "content-type": "application/json" },
			});
		});
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError: noopLogError });

		await fetchReddit({ url: "https://old.reddit.com/r/javascript/comments/1tlsqd1/title/" });

		expect(capturedUrl).toBe(
			"https://www.reddit.com/oembed?url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fjavascript%2Fcomments%2F1tlsqd1%2Ftitle%2F",
		);
	});

	it("normalises m.reddit.com to www.reddit.com in the oembed request URL", async () => {
		let capturedUrl = "";
		const crawlFetch = stubCrawlFetch(async (url) => {
			capturedUrl = url;
			return new Response(JSON.stringify({ title: "", author_name: "", html: "" }), {
				status: 200, headers: { "content-type": "application/json" },
			});
		});
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError: noopLogError });

		await fetchReddit({ url: "https://m.reddit.com/r/test/comments/abc/title/" });

		expect(capturedUrl).toBe(
			"https://www.reddit.com/oembed?url=https%3A%2F%2Fwww.reddit.com%2Fr%2Ftest%2Fcomments%2Fabc%2Ftitle%2F",
		);
	});

	it("preserves www.reddit.com host unchanged in the oembed request URL", async () => {
		let capturedUrl = "";
		const crawlFetch = stubCrawlFetch(async (url) => {
			capturedUrl = url;
			return new Response(JSON.stringify({ title: "", author_name: "", html: "" }), {
				status: 200, headers: { "content-type": "application/json" },
			});
		});
		const fetchReddit = initFetchRedditViaOembed({ crawlFetch, logError: noopLogError });

		await fetchReddit({ url: "https://www.reddit.com/r/test/comments/abc/title/?utm_source=share" });

		expect(capturedUrl).toBe(
			"https://www.reddit.com/oembed?url=https%3A%2F%2Fwww.reddit.com%2Fr%2Ftest%2Fcomments%2Fabc%2Ftitle%2F%3Futm_source%3Dshare",
		);
	});
});
