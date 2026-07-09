import type { CrawlFetch } from "./crawl-fetch";
import { extractThumbnailCandidates, initFetchThumbnailImage } from "./extract-thumbnail";

describe("extractThumbnailCandidates", () => {
	it("returns the og:image URL first when present", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="https://example.com/og.png">
				<meta name="twitter:image" content="https://example.com/twitter.png">
			</head><body><img src="https://example.com/body.png"></body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://example.com/article" })[0])
			.toBe("https://example.com/og.png");
	});

	it("falls back to twitter:image first when og:image is missing", () => {
		const html = `
			<html><head>
				<meta name="twitter:image" content="https://example.com/twitter.png">
			</head><body><img src="https://example.com/body.png"></body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://example.com/article" })[0])
			.toBe("https://example.com/twitter.png");
	});

	it("falls back to the first <img> when both meta tags are missing", () => {
		const html = `
			<html><head></head><body>
				<img src="https://example.com/first.png">
				<img src="https://example.com/second.png">
			</body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://example.com/article" })[0])
			.toBe("https://example.com/first.png");
	});

	it("resolves relative og:image URLs against the article base URL", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="/images/hero.png">
			</head><body></body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://blog.example.com/post" })[0])
			.toBe("https://blog.example.com/images/hero.png");
	});

	it("skips non-http(s) URLs (data:, javascript:, mailto:)", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="data:image/png;base64,iVBORw0KG...">
			</head><body>
				<img src="https://example.com/real.png">
			</body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://example.com/article" })[0])
			.toBe("https://example.com/real.png");
	});

	it("returns an empty array for relative URLs when baseUrl is omitted and the URL cannot be validated as http(s)", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="/images/hero.png">
			</head><body></body></html>
		`;
		expect(extractThumbnailCandidates({ html })).toEqual([]);
	});

	it("returns all candidates in og:image → twitter:image → <img> order", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="https://example.com/og.png">
				<meta name="twitter:image" content="https://example.com/twitter.png">
			</head><body>
				<img src="https://example.com/body-1.png">
				<img src="https://example.com/body-2.png">
			</body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://example.com/article" }))
			.toEqual([
				"https://example.com/og.png",
				"https://example.com/twitter.png",
				"https://example.com/body-1.png",
				"https://example.com/body-2.png",
			]);
	});

	it("dedupes identical URLs across the cascade", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="https://example.com/shared.png">
				<meta name="twitter:image" content="https://example.com/shared.png">
			</head><body>
				<img src="https://example.com/shared.png">
			</body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://example.com/article" }))
			.toEqual(["https://example.com/shared.png"]);
	});

	it("returns an empty array when no candidates are present", () => {
		const html = `<html><head></head><body><p>Text only.</p></body></html>`;
		expect(extractThumbnailCandidates({ html })).toEqual([]);
	});

	it("drops a relative URL when the baseUrl cannot anchor it (URL resolution throws)", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="/images/hero.png">
			</head><body></body></html>
		`;
		// "not a url" is not a valid base, so new URL("/images/hero.png", baseUrl)
		// throws; resolveIfRelative returns the raw relative URL, which then fails
		// the http(s) validity check and is dropped.
		expect(extractThumbnailCandidates({ html, baseUrl: "not a url" })).toEqual([]);
	});
});

describe("initFetchThumbnailImage", () => {
	it.each([403, 404, 406, 429])(
		"skips a candidate that returns a non-recoverable %i and logs the status at info",
		async (status) => {
			const infoLogs: string[] = [];
			const errorLogs: string[] = [];
			const crawlFetch: CrawlFetch = async () => new Response("blocked", { status });
			const fetchThumbnail = initFetchThumbnailImage({
				crawlFetch,
				logError: (message) => errorLogs.push(message),
				logInfo: (message) => infoLogs.push(message),
			});

			const result = await fetchThumbnail({
				candidates: ["https://example.com/missing.png"],
				referer: "https://example.com/article",
			});

			expect(result).toBeUndefined();
			expect(infoLogs).toContain(`[CrawlArticle] Thumbnail HTTP ${status} for https://example.com/missing.png`);
			expect(errorLogs).toEqual([]);
		},
	);

	it("skips a candidate that returns a non-ok status outside the non-recoverable set and logs it at error", async () => {
		const infoLogs: string[] = [];
		const errorLogs: string[] = [];
		const crawlFetch: CrawlFetch = async () => new Response(null, { status: 500 });
		const fetchThumbnail = initFetchThumbnailImage({
			crawlFetch,
			logError: (message) => errorLogs.push(message),
			logInfo: (message) => infoLogs.push(message),
		});

		const result = await fetchThumbnail({
			candidates: ["https://example.com/broken.png"],
			referer: "https://example.com/article",
		});

		expect(result).toBeUndefined();
		expect(errorLogs).toContain("[CrawlArticle] Thumbnail HTTP 500 for https://example.com/broken.png");
		expect(infoLogs).toEqual([]);
	});
});
