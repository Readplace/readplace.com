import { deflateSync } from "node:zlib";
import type { CrawlFetch } from "./crawl-fetch";
import { initFetchAnfArticle } from "./apple-news-anf";

type LogError = (message: string, error?: Error) => void;

const noopLogError: LogError = () => {};

function stubCrawlFetch(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return async (url) => handler(url);
}

const anfOk = (document: unknown): Response =>
	new Response(deflateSync(Buffer.from(JSON.stringify(document))), {
		status: 200,
		headers: { "content-type": "application/gzip" },
	});

const STORY_URL = "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA";
const DOCUMENT_URL = "https://c.apple.news/AgEXQWJ4UGdRUWRwUVN5LUVSeDJnLWtRWkEAMw";
const HERO_IMAGE_URL = "https://c.apple.news/AgEXQWJ4UGdRUWRwUVN5LUVSeDJnLWtRWkEAMA";

function fetchWith(response: (url: string) => Promise<Response> | Response, logError: LogError = noopLogError) {
	return initFetchAnfArticle({ crawlFetch: stubCrawlFetch(response), logError });
}

describe("fetchAnfArticle document URL", () => {
	it("derives the asset handle Apple itself publishes as the shell og:image, with the document index", async () => {
		let capturedUrl = "";
		const fetchAnf = fetchWith((url) => {
			capturedUrl = url;
			return anfOk({ title: "T", components: [{ role: "body", text: "Hello." }] });
		});

		await fetchAnf({ url: STORY_URL });

		expect(capturedUrl).toBe(DOCUMENT_URL);
	});

	it("derives the same handle for a story URL carrying Apple News campaign parameters", async () => {
		let capturedUrl = "";
		const fetchAnf = fetchWith((url) => {
			capturedUrl = url;
			return anfOk({ title: "T", components: [{ role: "body", text: "Hello." }] });
		});

		await fetchAnf({ url: `${STORY_URL}?articleList=Aa2vGyZWlSfaFMqEGY0e4xQ&campaign_id=E101` });

		expect(capturedUrl).toBe(DOCUMENT_URL);
	});

	it("derives a different handle for a different story id", async () => {
		let capturedUrl = "";
		const fetchAnf = fetchWith((url) => {
			capturedUrl = url;
			return anfOk({ title: "T", components: [{ role: "body", text: "Hello." }] });
		});

		await fetchAnf({ url: "https://apple.news/AdLHfGuaTSHGNWIFrj0gdGg" });

		expect(capturedUrl).toBe("https://c.apple.news/AgEXQWRMSGZHdWFUU0hHTldJRnJqMGdkR2cAMw");
	});
});

describe("fetchAnfArticle story id rejection", () => {
	it.each([
		["a channel path with no id", "https://apple.news/"],
		["a multi-segment path", "https://apple.news/foryou/latest"],
		["an id below the length floor", "https://apple.news/A123"],
		["an id carrying characters outside the base64url alphabet", "https://apple.news/Abx.PgQQdpQSy-ERx2g"],
		["an unparseable URL", "not a url"],
	])("returns undefined without fetching for %s", async (_case, url) => {
		let fetched = false;
		const fetchAnf = fetchWith(() => {
			fetched = true;
			return anfOk({ title: "T", components: [] });
		});

		await expect(fetchAnf({ url })).resolves.toBeUndefined();
		expect(fetched).toBe(false);
	});
});

describe("fetchAnfArticle rendering", () => {
	it("renders the title, hero image and every prose role in document order", async () => {
		const fetchAnf = fetchWith(() =>
			anfOk({
				title: "Tom Holland",
				components: [
					{ role: "title", text: "Ignored heading" },
					{ role: "intro", text: "The standfirst." },
					{ role: "body", text: "First paragraph." },
					{ role: "heading2", text: "A section" },
					{ role: "quote", text: "A quotation." },
				],
			}),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBe(
			`<html><head><title>Tom Holland</title><meta property="og:image" content="${HERO_IMAGE_URL}"></head>` +
				`<body><article><h1>Tom Holland</h1><img src="${HERO_IMAGE_URL}" alt=""/>` +
				"<p>The standfirst.</p><p>First paragraph.</p><h2>A section</h2><blockquote>A quotation.</blockquote>" +
				"</article></body></html>",
		);
	});

	it("collects prose nested inside structural containers", async () => {
		const fetchAnf = fetchWith(() =>
			anfOk({
				title: "T",
				components: [
					{
						role: "container",
						components: [{ role: "section", components: [{ role: "body", text: "Deep." }] }],
					},
				],
			}),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toContain("<p>Deep.</p>");
	});

	it("clamps heading levels so the article title keeps sole ownership of h1", async () => {
		const fetchAnf = fetchWith(() =>
			anfOk({
				title: "T",
				components: [
					{ role: "heading", text: "Bare" },
					{ role: "heading1", text: "One" },
					{ role: "heading6", text: "Six" },
				],
			}),
		);

		const html = await fetchAnf({ url: STORY_URL });

		expect(html).toContain("<h2>Bare</h2><h2>One</h2><h6>Six</h6>");
	});

	it("escapes markup in the title and in prose so publisher copy can never inject", async () => {
		const fetchAnf = fetchWith(() =>
			anfOk({
				title: '<script>alert("t")</script>',
				components: [{ role: "body", text: "5 < 6 & \"quoted\"" }],
			}),
		);

		const html = await fetchAnf({ url: STORY_URL });

		expect(html).toContain("<title>&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;</title>");
		expect(html).toContain("<p>5 &lt; 6 &amp; &quot;quoted&quot;</p>");
	});

	it.each([
		["a component that is not an object", "not-an-object"],
		["a null component", null],
	])("skips %s", async (_case, node) => {
		const fetchAnf = fetchWith(() =>
			anfOk({ title: "T", components: [node, { role: "body", text: "Kept." }] }),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toContain("<p>Kept.</p>");
	});

	it.each([
		["a non-string role", { role: 7, text: "Dropped." }],
		["a non-string text", { role: "body", text: 7 }],
		["whitespace-only text", { role: "body", text: "   " }],
	])("drops a component with %s", async (_case, node) => {
		const fetchAnf = fetchWith(() => anfOk({ title: "T", components: [node, { role: "body", text: "Kept." }] }));

		const html = await fetchAnf({ url: STORY_URL });

		expect(html).toContain("<article><h1>T</h1>");
		expect(html).toContain("<p>Kept.</p>");
		expect(html).not.toContain("Dropped.");
	});
});

describe("fetchAnfArticle links", () => {
	it("wraps the addition range in an anchor and escapes both href and text", async () => {
		const fetchAnf = fetchWith(() =>
			anfOk({
				title: "T",
				components: [
					{
						role: "body",
						text: "South Carolina Republicans lost.",
						additions: [
							{
								type: "link",
								URL: "https://www.theguardian.com/us-news/south-carolina?a=1&b=2",
								range: { start: 0, length: 14 },
							},
						],
					},
				],
			}),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toContain(
			'<p><a href="https://www.theguardian.com/us-news/south-carolina?a=1&amp;b=2">South Carolina</a> Republicans lost.</p>',
		);
	});

	it("orders anchors by range start regardless of the order Apple listed them", async () => {
		const fetchAnf = fetchWith(() =>
			anfOk({
				title: "T",
				components: [
					{
						role: "body",
						text: "alpha beta",
						additions: [
							{ type: "link", URL: "https://b.example/", range: { start: 6, length: 4 } },
							{ type: "link", URL: "https://a.example/", range: { start: 0, length: 5 } },
						],
					},
				],
			}),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toContain(
			'<p><a href="https://a.example/">alpha</a> <a href="https://b.example/">beta</a></p>',
		);
	});

	it("clamps a range that runs past the end of the text", async () => {
		const fetchAnf = fetchWith(() =>
			anfOk({
				title: "T",
				components: [
					{
						role: "body",
						text: "short",
						additions: [{ type: "link", URL: "https://a.example/", range: { start: 0, length: 999 } }],
					},
				],
			}),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toContain('<p><a href="https://a.example/">short</a></p>');
	});

	it("keeps the first of two overlapping ranges and drops the second", async () => {
		const fetchAnf = fetchWith(() =>
			anfOk({
				title: "T",
				components: [
					{
						role: "body",
						text: "alpha beta",
						additions: [
							{ type: "link", URL: "https://a.example/", range: { start: 0, length: 7 } },
							{ type: "link", URL: "https://b.example/", range: { start: 6, length: 4 } },
						],
					},
				],
			}),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toContain(
			'<p><a href="https://a.example/">alpha b</a>eta</p>',
		);
	});

	it.each([
		["additions that are not an array", { additions: "nope" }],
		["an addition of another type", { additions: [{ type: "photo", URL: "https://a.example/", range: { start: 0, length: 5 } }] }],
		["a malformed range", { additions: [{ type: "link", URL: "https://a.example/", range: { start: -1, length: 5 } }] }],
		["a non-http scheme", { additions: [{ type: "link", URL: "javascript:alert(1)", range: { start: 0, length: 5 } }] }],
		["an unparseable URL", { additions: [{ type: "link", URL: "not a url", range: { start: 0, length: 5 } }] }],
	])("renders plain text for %s", async (_case, extra) => {
		const fetchAnf = fetchWith(() =>
			anfOk({ title: "T", components: [{ role: "body", text: "alpha beta", ...extra }] }),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toContain("<p>alpha beta</p>");
	});
});

describe("fetchAnfArticle unavailable documents", () => {
	it("returns undefined and stays silent on 404, the expected answer for a story Apple holds no document for", async () => {
		const logged: string[] = [];
		const fetchAnf = fetchWith(() => new Response(null, { status: 404 }), (message) => logged.push(message));

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBeUndefined();
		expect(logged).toEqual([]);
	});

	it("logs and returns undefined on an unexpected status", async () => {
		const logged: string[] = [];
		const fetchAnf = fetchWith(() => new Response(null, { status: 500 }), (message) => logged.push(message));

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBeUndefined();
		expect(logged).toEqual([`[AppleNewsAnf] document HTTP 500 for ${STORY_URL}`]);
	});

	it("logs and returns undefined when the document holds no role this renderer maps to prose", async () => {
		const logged: string[] = [];
		const fetchAnf = fetchWith(
			() => anfOk({ title: "T", components: [{ role: "caption", text: "A photo caption." }] }),
			(message) => logged.push(message),
		);

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBeUndefined();
		expect(logged).toEqual([`[AppleNewsAnf] document carries no renderable text for ${STORY_URL}`]);
	});

	it("returns undefined when the envelope carries no components at all", async () => {
		const fetchAnf = fetchWith(() => anfOk({ title: "T", components: "not-an-array" }));

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBeUndefined();
	});

	it("returns undefined when the payload is not an ANF envelope", async () => {
		const fetchAnf = fetchWith(() => anfOk(["not", "an", "envelope"]));

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBeUndefined();
	});

	it("falls back to an empty title when Apple sends a non-string one", async () => {
		const fetchAnf = fetchWith(() => anfOk({ title: 7, components: [{ role: "body", text: "Body." }] }));

		await expect(fetchAnf({ url: STORY_URL })).resolves.toContain("<title></title>");
	});
});

describe("fetchAnfArticle transport failures", () => {
	it.each([
		["the body is not deflate-compressed", () => new Response(Buffer.from("plain bytes"), { status: 200 })],
		[
			"the inflated body is not JSON",
			() => new Response(deflateSync(Buffer.from("<html>not json</html>")), { status: 200 }),
		],
		[
			"the compressed body exceeds the byte cap",
			() => new Response(Buffer.alloc(5 * 1024 * 1024), { status: 200 }),
		],
		[
			"the body inflates past the output cap",
			() => new Response(deflateSync(Buffer.alloc(33 * 1024 * 1024)), { status: 200 }),
		],
	])("logs and returns undefined when %s", async (_case, response) => {
		const logged: string[] = [];
		const fetchAnf = fetchWith(response, (message) => logged.push(message));

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBeUndefined();
		expect(logged).toEqual([`[AppleNewsAnf] document error for ${STORY_URL}`]);
	});

	it("passes a thrown Error through to the logger", async () => {
		const networkError = new Error("network down");
		const logged: { message: string; error?: Error }[] = [];
		const fetchAnf = initFetchAnfArticle({
			crawlFetch: async () => {
				throw networkError;
			},
			logError: (message, error) => logged.push({ message, error }),
		});

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBeUndefined();
		expect(logged).toEqual([{ message: `[AppleNewsAnf] document error for ${STORY_URL}`, error: networkError }]);
	});

	it("reports a non-Error throw without an error object", async () => {
		const logged: { message: string; error?: Error }[] = [];
		const fetchAnf = initFetchAnfArticle({
			crawlFetch: async () => {
				throw "string error";
			},
			logError: (message, error) => logged.push({ message, error }),
		});

		await expect(fetchAnf({ url: STORY_URL })).resolves.toBeUndefined();
		expect(logged).toEqual([{ message: `[AppleNewsAnf] document error for ${STORY_URL}`, error: undefined }]);
	});
});
