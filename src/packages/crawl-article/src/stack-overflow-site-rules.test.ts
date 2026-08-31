import type { CrawlFetch } from "./crawl-fetch";
import { initStackOverflowSiteRules } from "./stack-overflow-site-rules";

const noopLogError = () => {};

function stubCrawlFetch(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return async (url) => handler(url);
}

const okFeed = (xml: string): Response =>
	new Response(xml, { status: 200, headers: { "content-type": "application/atom+xml" } });

function atomFeed(entries: readonly string[]): string {
	return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join("")}</feed>`;
}

const questionEntry = `<entry><id>https://stackoverflow.com/q/42</id><title type="text">Why is the sky blue?</title><author><name>Curious</name></author><summary type="html">&lt;p&gt;I looked up.&lt;/p&gt;</summary></entry>`;
const answerEntry = `<entry><id>https://stackoverflow.com/questions/42/-/43#43</id><title type="text">Answer by Rayleigh for Why is the sky blue?</title><author><name>Rayleigh</name></author><summary type="html">&lt;p&gt;Scattering.&lt;/p&gt;</summary></entry>`;

describe("stackOverflowSiteRules.matches", () => {
	const site = initStackOverflowSiteRules({
		crawlFetch: stubCrawlFetch(() => new Response()),
		logError: noopLogError,
	});

	it("matches the long /questions/<id>/<slug> form", () => {
		expect(
			site.matches({
				url: "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster",
				hostname: "stackoverflow.com",
			}),
		).toBe(true);
	});

	it("matches the short /q/<id> form", () => {
		expect(site.matches({ url: "https://stackoverflow.com/q/11227809", hostname: "stackoverflow.com" })).toBe(true);
	});

	it("matches the www host", () => {
		expect(
			site.matches({ url: "https://www.stackoverflow.com/q/11227809?foo=1", hostname: "www.stackoverflow.com" }),
		).toBe(true);
	});

	it("does not match a Stack Overflow path that is not a question", () => {
		expect(site.matches({ url: "https://stackoverflow.com/tags/java", hostname: "stackoverflow.com" })).toBe(false);
	});

	it("does not match a sibling Stack Exchange host", () => {
		expect(site.matches({ url: "https://superuser.com/questions/42/why", hostname: "superuser.com" })).toBe(false);
	});

	it("does not match a value that is not a URL", () => {
		expect(site.matches({ url: "not a url", hostname: "" })).toBe(false);
	});
});

describe("stackOverflowSiteRules.onCrawl", () => {
	it("composes the question and every answer into one article document", async () => {
		const site = initStackOverflowSiteRules({
			crawlFetch: stubCrawlFetch(async () => okFeed(atomFeed([questionEntry, answerEntry]))),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/questions/42/why-is-the-sky-blue" });

		expect(result).toEqual({
			kind: "content",
			html:
				"<html><head>" +
				"<title>Why is the sky blue?</title>" +
				'<meta property="og:site_name" content="Stack Overflow">' +
				'<meta property="og:image" content="https://cdn.sstatic.net/Sites/stackoverflow/Img/apple-touch-icon@2.png">' +
				"</head><body><article>" +
				"<h1>Why is the sky blue?</h1>" +
				"<p>I looked up.</p>" +
				"<h2>Answer by Rayleigh</h2>" +
				"<p>Scattering.</p>" +
				"</article></body></html>",
		});
	});

	it("fetches the slug-agnostic feed URL for both the long and short question forms", async () => {
		const requested: string[] = [];
		const site = initStackOverflowSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => {
				requested.push(url);
				return okFeed(atomFeed([questionEntry]));
			}),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "https://stackoverflow.com/questions/11227809/a-slug-that-has-since-changed" });
		await site.onCrawl({ url: "https://www.stackoverflow.com/q/11227809?utm_source=share" });

		expect(requested).toEqual([
			"https://stackoverflow.com/feeds/question/11227809",
			"https://stackoverflow.com/feeds/question/11227809",
		]);
	});

	it("escapes markup characters carried by the question title", async () => {
		const titled = `<entry><title type="text">Why does a &lt;div&gt; break &amp; wrap?</title><summary type="html">&lt;p&gt;Body.&lt;/p&gt;</summary></entry>`;
		const site = initStackOverflowSiteRules({
			crawlFetch: stubCrawlFetch(async () => okFeed(atomFeed([titled]))),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/q/42" });

		expect(result).toEqual({
			kind: "content",
			html:
				"<html><head>" +
				"<title>Why does a &lt;div&gt; break &amp; wrap?</title>" +
				'<meta property="og:site_name" content="Stack Overflow">' +
				'<meta property="og:image" content="https://cdn.sstatic.net/Sites/stackoverflow/Img/apple-touch-icon@2.png">' +
				"</head><body><article>" +
				"<h1>Why does a &lt;div&gt; break &amp; wrap?</h1>" +
				"<p>Body.</p>" +
				"</article></body></html>",
		});
	});

	it("titles an answer whose entry carries no author element", async () => {
		const anonymous = `<entry><title type="text">Answer for Why is the sky blue?</title><summary type="html">&lt;p&gt;Scattering.&lt;/p&gt;</summary></entry>`;
		const site = initStackOverflowSiteRules({
			crawlFetch: stubCrawlFetch(async () => okFeed(atomFeed([questionEntry, anonymous]))),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/q/42" });

		expect(result).toEqual({
			kind: "content",
			html: expect.stringContaining("<h2>Answer</h2><p>Scattering.</p>"),
		});
	});

	it("titles an answer whose author element carries no name", async () => {
		const unnamed = `<entry><title type="text">Answer</title><author><uri>https://stackoverflow.com/users/1</uri></author><summary type="html">&lt;p&gt;Scattering.&lt;/p&gt;</summary></entry>`;
		const site = initStackOverflowSiteRules({
			crawlFetch: stubCrawlFetch(async () => okFeed(atomFeed([questionEntry, unnamed]))),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/q/42" });

		expect(result).toEqual({
			kind: "content",
			html: expect.stringContaining("<h2>Answer</h2><p>Scattering.</p>"),
		});
	});

	it("emits an empty body for a question entry carrying no summary", async () => {
		const bodiless = `<entry><title type="text">Why is the sky blue?</title></entry>`;
		const site = initStackOverflowSiteRules({
			crawlFetch: stubCrawlFetch(async () => okFeed(atomFeed([bodiless]))),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/q/42" });

		expect(result).toEqual({
			kind: "content",
			html: expect.stringContaining("<h1>Why is the sky blue?</h1></article>"),
		});
	});

	it("declines and logs the status when the feed responds non-ok, so the normal fetch cascade still runs", async () => {
		const logError = jest.fn();
		const site = initStackOverflowSiteRules({
			crawlFetch: stubCrawlFetch(async () => new Response(null, { status: 403 })),
			logError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/q/42" });

		expect(result).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] question feed HTTP 403 for https://stackoverflow.com/q/42",
		);
	});

	it("declines and logs when the response carries no Atom entry", async () => {
		const logError = jest.fn();
		const site = initStackOverflowSiteRules({
			crawlFetch: stubCrawlFetch(async () => okFeed("<html><body>challenge</body></html>")),
			logError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/q/42" });

		expect(result).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] question feed carries no entry for https://stackoverflow.com/q/42",
		);
	});

	it("declines and logs the error when the feed fetch throws", async () => {
		const networkError = new Error("network down");
		const logError = jest.fn();
		const site = initStackOverflowSiteRules({
			crawlFetch: async () => {
				throw networkError;
			},
			logError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/q/42" });

		expect(result).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] question feed error for https://stackoverflow.com/q/42",
			networkError,
		);
	});

	it("declines and logs an undefined error when the feed fetch rejects with a non-Error value", async () => {
		const logError = jest.fn();
		const site = initStackOverflowSiteRules({
			crawlFetch: async () => {
				throw "string error";
			},
			logError,
		});

		const result = await site.onCrawl({ url: "https://stackoverflow.com/q/42" });

		expect(result).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] question feed error for https://stackoverflow.com/q/42",
			undefined,
		);
	});
});
