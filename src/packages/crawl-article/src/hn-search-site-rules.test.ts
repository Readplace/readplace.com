import { parseHTML } from "linkedom";
import type { CrawlFetch } from "./crawl-fetch";
import { initHnSearchSiteRules } from "./hn-search-site-rules";

const SEARCH_URL = "https://hn.algolia.com/?dateRange=all&page=0&prefix=true&query=glass%20frog&sort=byPopularity&type=story";

function hit(id: number) {
	return {
		objectID: String(id),
		title: `Story ${id}`,
		url: `https://example.org/story/${id}`,
		story_text: id === 1 ? "A returned story body." : null,
		_tags: ["story"],
		points: id,
		num_comments: id + 1,
		author: "author",
		created_at: "2026-01-01T00:00:00.000Z",
	};
}

function payload(hits: unknown[] = [hit(1)]) {
	return { query: "glass frog", page: 0, hitsPerPage: 30, hits };
}

function site(fetch: CrawlFetch, logError = jest.fn()) {
	return { rule: initHnSearchSiteRules({ crawlFetch: fetch, logError }), logError };
}

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HN search crawl rule", () => {
	it("claims only the observed HTTPS root with six unique supported controls", async () => {
		const { rule } = site(async () => response(payload()));
		expect(rule.matches({ url: SEARCH_URL, hostname: "hn.algolia.com" })).toBe(true);
		const unsupported = [
			"not a URL",
			SEARCH_URL.replace("https:", "http:"),
			SEARCH_URL.replace("hn.algolia.com", "other.algolia.com"),
			SEARCH_URL.replace("hn.algolia.com", "hn.algolia.com:8443"),
			SEARCH_URL.replace("/?", "/search?"),
			`${SEARCH_URL}&query=other`,
			SEARCH_URL.replace("type=story", "query=other"),
			`${SEARCH_URL}&unknown=1`,
			SEARCH_URL.replace("query=glass%20frog", "query="),
			SEARCH_URL.replace("page=0", "page=1"),
			SEARCH_URL.replace("dateRange=all", "dateRange=last24h"),
			SEARCH_URL.replace("prefix=true", "prefix=false"),
			SEARCH_URL.replace("sort=byPopularity", "sort=byDate"),
			SEARCH_URL.replace("type=story", "type=comment"),
			`${SEARCH_URL}#section`,
		];
		for (const url of unsupported) {
			expect(rule.matches({ url, hostname: "hn.algolia.com" })).toBe(false);
			expect(await rule.onCrawl({ url })).toEqual({ kind: "skip" });
		}
	});

	it("maps the saved query to the public API and returns content under the saved identity", async () => {
		const requested: { url: string; budgetMs: number }[] = [];
		const { rule } = site(async (url, init) => {
			requested.push({ url, budgetMs: init.budgetMs });
			return response(payload());
		});
		const outcome = await rule.onCrawl({ url: SEARCH_URL });
		expect(outcome.kind).toBe("content");
		expect(requested).toHaveLength(1);
		const api = new URL(requested[0].url);
		expect(api.origin + api.pathname).toBe("https://hn.algolia.com/api/v1/search");
		expect(Object.fromEntries(api.searchParams)).toEqual({
			query: "glass frog",
			tags: "story",
			page: "0",
			hitsPerPage: "30",
			queryType: "prefixLast",
			restrictSearchableAttributes: "title,comment_text,url,story_text,author",
		});
		expect(requested[0].budgetMs).toBe(10000);
		if (outcome.kind !== "content") throw new Error("Expected content");
		expect(outcome.html).toContain("<title>Search results for “glass frog”</title>");
		expect(outcome.html).toContain("<h1>Search results for “glass frog”</h1>");
		expect(outcome.html).toContain("A returned story body.");
		const { document } = parseHTML(outcome.html);
		expect(document.querySelector("h2 a")?.getAttribute("href")).toBe("https://news.ycombinator.com/item?id=1");
	});

	it("preserves query text exactly and escapes untrusted result fields while omitting unsafe URLs", async () => {
		const query = '<frog & "toad">';
		const url = SEARCH_URL.replace("glass%20frog", encodeURIComponent(query));
		const hostile = {
			...hit(1),
			title: "<img src=x onerror=alert(1)>",
			url: "javascript:alert(1)",
			story_text: "<p>Safe &amp; sound.</p><p>Next <strong>line</strong>.</p><script>alert(2)</script>",
			author: "<admin>",
		};
		const { rule } = site(async (requested) => {
			expect(new URL(requested).searchParams.get("query")).toBe(query);
			return response({ ...payload([hostile]), query });
		});
		const outcome = await rule.onCrawl({ url });
		if (outcome.kind !== "content") throw new Error("Expected content");
		const { document } = parseHTML(outcome.html);
		expect(document.querySelector("title")?.textContent).toBe(`Search results for “${query}”`);
		expect(document.querySelector("h1")?.textContent).toBe(`Search results for “${query}”`);
		expect(document.querySelectorAll("script, img")).toHaveLength(0);
		expect(outcome.html).not.toContain('href="javascript:');
		expect(document.querySelector("h2")?.textContent).toBe(hostile.title);
		expect(outcome.html).toContain("<p>Safe &amp; sound.</p><p>Next line.</p>");
		expect(document.querySelector("section")?.textContent).toContain("Safe & sound.Next line.");
		expect(outcome.html).not.toContain("alert(2)");
	});

	it.each([
		["HTTP error", () => new Response(null, { status: 429 })],
		["partial HTTP response", () => response(payload(), 206)],
		["query mismatch", () => response({ ...payload(), query: "other" })],
		["page mismatch", () => response({ ...payload(), page: 1 })],
		["page size mismatch", () => response({ ...payload(), hitsPerPage: 20 })],
		["empty hits", () => response(payload([]))],
		["more than one result page", () => response(payload(Array.from({ length: 31 }, (_, index) => hit(index + 1))))],
		["non-array hits", () => response({ ...payload(), hits: {} })],
		["non-object hit", () => response(payload([null]))],
		["non-string ID", () => response(payload([{ ...hit(1), objectID: 1 }]))],
		["non-numeric ID", () => response(payload([{ ...hit(1), objectID: "1x" }]))],
		["non-story hit", () => response(payload([{ ...hit(1), _tags: ["comment"] }]))],
		["missing tags", () => response(payload([{ ...hit(1), _tags: null }]))],
		["duplicate IDs", () => response(payload([hit(1), hit(1)]))],
		["missing title", () => response(payload([{ ...hit(1), title: "" }]))],
		["non-string title", () => response(payload([{ ...hit(1), title: 1 }]))],
		["invalid external URL field", () => response(payload([{ ...hit(1), url: 1 }]))],
		["invalid story text field", () => response(payload([{ ...hit(1), story_text: 1 }]))],
		["invalid author field", () => response(payload([{ ...hit(1), author: 1 }]))],
		["invalid date field", () => response(payload([{ ...hit(1), created_at: 1 }]))],
		["invalid points field", () => response(payload([{ ...hit(1), points: "many" }]))],
		["nonfinite points field", () => new Response('{"query":"glass frog","page":0,"hitsPerPage":30,"hits":[{"objectID":"1","title":"Story","_tags":["story"],"points":1e999}]}', { status: 200 })],
		["invalid comment count", () => response(payload([{ ...hit(1), num_comments: "many" }]))],
		["invalid JSON", () => new Response("{", { status: 200 })],
		["body missing", () => new Response(null, { status: 200 })],
	] as const)("declines on %s so the normal crawl remains available", async (_name, answer) => {
		const { rule, logError } = site(async () => answer());
		expect(await rule.onCrawl({ url: SEARCH_URL })).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalled();
	});

	it("declines on a network exception", async () => {
		const { rule } = site(async () => { throw new Error("network down"); });
		expect(await rule.onCrawl({ url: SEARCH_URL })).toEqual({ kind: "skip" });
	});

	it("declines and logs when the transport rejects with a non-Error value", async () => {
		const { rule, logError } = site(() => Promise.reject("network down"));
		expect(await rule.onCrawl({ url: SEARCH_URL })).toEqual({ kind: "skip" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] HN search API error", undefined);
	});

	it("declines when the fetch throws before returning a promise", async () => {
		const { rule } = site(() => { throw new Error("sync transport failure"); });
		expect(await rule.onCrawl({ url: SEARCH_URL })).toEqual({ kind: "skip" });
	});

	it("declines when the API body exceeds the limit", async () => {
		const { rule } = site(async () => new Response("x".repeat(2_000_001), { status: 200 }));
		expect(await rule.onCrawl({ url: SEARCH_URL })).toEqual({ kind: "skip" });
	});

	it("keeps valid sparse hits and omits unusable external links", async () => {
		const sparse = { objectID: "9", title: "Sparse story", _tags: ["story"] };
		const invalidUrl = { ...hit(10), url: "not a URL", story_text: "<p>First</p><p>Second<br>line</p><!-- comment --><style>hidden</style>" };
		const credentialUrl = { ...hit(11), url: "https://user:password@example.org/private", story_text: "<div>Third <em>line</em></div>" };
		const httpUrl = { ...hit(12), url: "http://example.org/story/12", author: null, created_at: null, points: null, num_comments: null };
		const { rule } = site(async () => response(payload([sparse, invalidUrl, credentialUrl, httpUrl])));
		const result = await rule.onCrawl({ url: SEARCH_URL });
		if (result.kind !== "content") throw new Error("Expected content");
		const { document } = parseHTML(result.html);
		expect(document.querySelectorAll("section.search-result")).toHaveLength(4);
		expect(document.querySelectorAll("a[href^='https://news.ycombinator.com/item?id=']")).toHaveLength(4);
		expect(result.html).not.toContain("user:password");
		expect(result.html).not.toContain("hidden");
		expect(result.html).toContain("<p>First</p><p>Second</p><p>line</p>");
		expect(result.html).toContain("<p>Third line</p>");
		expect(result.html).toContain('href="http://example.org/story/12"');
	});

	it("declines when a streamed response errors", async () => {
		const { rule } = site(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("body failed")); } }), { status: 200 }));
		expect(await rule.onCrawl({ url: SEARCH_URL })).toEqual({ kind: "skip" });
	});

	it("declines when the API response body stalls past the shared fetch deadline", async () => {
		jest.useFakeTimers();
		try {
			let fetchSignal: AbortSignal | undefined;
			const { rule } = site(async (_url, init) => {
				fetchSignal = init.signal;
				return new Response(new ReadableStream({ start() {}, cancel() { return Promise.reject(new Error("cancel failed")); } }), { status: 200 });
			});
			const outcome = rule.onCrawl({ url: SEARCH_URL });
			await jest.advanceTimersByTimeAsync(10_000);
			expect(await outcome).toEqual({ kind: "skip" });
			expect(fetchSignal?.aborted).toBe(true);
		} finally {
			jest.useRealTimers();
		}
	});

	it("declines when response headers arrive after the shared fetch deadline", async () => {
		jest.useFakeTimers();
		try {
			let fetchSignal: AbortSignal | undefined;
			const { rule } = site((_url, init) => new Promise<Response>((resolve) => {
				fetchSignal = init.signal;
				setTimeout(() => resolve(new Response(new ReadableStream({ start() {} }), { status: 200 })), 10_001);
			}));
			const outcome = rule.onCrawl({ url: SEARCH_URL });
			await jest.advanceTimersByTimeAsync(10_001);
			expect(await outcome).toEqual({ kind: "skip" });
			expect(fetchSignal?.aborted).toBe(true);
		} finally {
			jest.useRealTimers();
		}
	});
});
