import type { CrawlFetch } from "./crawl-fetch";
import {
	extractThumbnailCandidates,
	initFetchThumbnailImage,
	isValidHttpUrl,
	MAX_THUMBNAIL_BYTES,
} from "./extract-thumbnail";

describe("extractThumbnailCandidates", () => {
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

describe("isValidHttpUrl", () => {
	it.each([
		["https://example.com/a.png", true],
		["HTTPS://example.com/a.png", true],
		["data:image/gif;base64,R0lGOD", false],
		["chrome-extension://abc/icon.svg", false],
		["/relative/a.png", false],
		["", false],
	])("isValidHttpUrl accepts only an absolute http(s) URL: %j → %s", (input, expected) => {
		expect(isValidHttpUrl(input)).toBe(expected);
	});
});

describe("initFetchThumbnailImage", () => {
	it.each([403, 404, 406, 429, 498])(
		"skips a candidate that returns a non-recoverable %i and logs the status at info",
		async (status) => {
			const infoLogs: string[] = [];
			const errorLogs: string[] = [];
			const crawlFetch: CrawlFetch = async () => new Response("blocked", { status });
			const fetchThumbnail = initFetchThumbnailImage({
				crawlFetch,
				logError: (message) => errorLogs.push(message),
				logInfo: (message) => infoLogs.push(message),
				logThumbnailNotDelivered: () => {},
			});

			const result = await fetchThumbnail({
				candidates: ["https://example.com/missing.png"],
				referer: "https://example.com/article",
			});

			expect(result.image).toBeUndefined();
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
			logThumbnailNotDelivered: () => {},
		});

		const result = await fetchThumbnail({
			candidates: ["https://example.com/broken.png"],
			referer: "https://example.com/article",
		});

		expect(result.image).toBeUndefined();
		expect(errorLogs).toContain("[CrawlArticle] Thumbnail HTTP 500 for https://example.com/broken.png");
		expect(infoLogs).toEqual([]);
	});
	it.each([403, 500])(
		"leaves a candidate that answered %i unproven, because the origin may still serve the image to a reader's own browser",
		async (status) => {
			const crawlFetch: CrawlFetch = async () => new Response("refused", { status });
			const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

			const result = await fetchThumbnail({
				candidates: ["https://example.com/hotlink-blocked.png"],
				referer: "https://example.com/article",
			});

			expect(result.provenUnusable).toEqual([]);
		},
	);

	it.each([404, 410])(
		"proves a candidate unusable when the origin answers %i, because the resource is gone for every client",
		async (status) => {
			const crawlFetch: CrawlFetch = async () => new Response("<html>not found</html>", { status });
			const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

			const result = await fetchThumbnail({
				candidates: ["https://zserge.com/logo.png"],
				referer: "https://example.com/article",
			});

			expect(result.provenUnusable).toEqual(["https://zserge.com/logo.png"]);
		},
	);

	it("leaves a candidate that failed in transport unproven, because no answer is no evidence", async () => {
		const crawlFetch: CrawlFetch = async () => {
			throw new Error("socket hang up");
		};
		const logError = jest.fn();
		const logThumbnailNotDelivered = jest.fn();
		const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError, logInfo: () => {}, logThumbnailNotDelivered });

		const result = await fetchThumbnail({
			candidates: ["https://example.com/unreachable.png"],
			referer: "https://example.com/article",
		});

		expect(result.provenUnusable).toEqual([]);
		expect(logThumbnailNotDelivered).toHaveBeenCalledWith({
			message: "[CrawlArticle] thumbnail candidate not delivered",
			url: "https://example.com/unreachable.png",
			name: "Error",
			reason: "socket hang up",
		});
		expect(logError).not.toHaveBeenCalled();
	});

	it("proves a candidate unusable when the origin answers a non-image Content-Type", async () => {
		const crawlFetch: CrawlFetch = async () =>
			new Response("<html>redirect loop</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

		const result = await fetchThumbnail({
			candidates: ["https://www.cia.gov/readingroom/docs/Figure%203"],
			referer: "https://www.cia.gov/readingroom/docs/report.pdf",
		});

		expect(result.provenUnusable).toEqual(["https://www.cia.gov/readingroom/docs/Figure%203"]);
	});

	it("proves a candidate unusable when the origin declares a body over the size cap", async () => {
		const crawlFetch: CrawlFetch = async () =>
			new Response("bytes", {
				status: 200,
				headers: { "content-type": "image/png", "content-length": String(MAX_THUMBNAIL_BYTES + 1) },
			});
		const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

		const result = await fetchThumbnail({
			candidates: ["https://qsf.cf2.quoracdn.net/huge.png"],
			referer: "https://example.com/article",
		});

		expect(result.provenUnusable).toEqual(["https://qsf.cf2.quoracdn.net/huge.png"]);
	});

	it("walks past a disproved candidate to the next one and reports only what it disproved", async () => {
		const crawlFetch: CrawlFetch = async (url) =>
			url === "https://example.com/not-an-image"
				? new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } })
				: new Response(Buffer.from("png-bytes"), { status: 200, headers: { "content-type": "image/png" } });
		const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

		const result = await fetchThumbnail({
			candidates: ["https://example.com/not-an-image", "https://example.com/real.png"],
			referer: "https://example.com/article",
		});

		expect(result.image?.url).toBe("https://example.com/real.png");
		expect(result.provenUnusable).toEqual(["https://example.com/not-an-image"]);
	});

	const candidatesNumbered = (count: number) =>
		Array.from({ length: count }, (_, index) => `https://example.com/candidate-${index + 1}.png`);

	it("fetches at most five candidates whatever their outcomes and logs one error naming how many were left unfetched", async () => {
		const fetchedUrls: string[] = [];
		const errorLogs: string[] = [];
		const candidates = candidatesNumbered(7);
		const crawlFetch: CrawlFetch = async (url) => {
			fetchedUrls.push(url);
			if (url === candidates[1]) throw new TypeError("fetch failed");
			if (url === candidates[0] || url === candidates[3]) return new Response("boom", { status: 500 });
			return new Response("gone", { status: 404 });
		};
		const fetchThumbnail = initFetchThumbnailImage({
			crawlFetch,
			logError: (message) => errorLogs.push(message),
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		});

		const result = await fetchThumbnail({ candidates, referer: "https://example.com/article" });

		expect(result.image).toBeUndefined();
		expect(fetchedUrls).toEqual(candidatesNumbered(5));
		expect(result.fetched).toEqual(candidatesNumbered(5));
		expect(result.provenUnusable).toEqual([candidates[2], candidates[4]]);
		expect(errorLogs).toEqual([
			"[CrawlArticle] Thumbnail HTTP 500 for https://example.com/candidate-1.png",
			"[CrawlArticle] Thumbnail HTTP 500 for https://example.com/candidate-4.png",
			"[CrawlArticle] Thumbnail candidate cap reached: fetched 5 of 7 candidates for https://example.com/article",
		]);
	});

	it("logs the cap error when a sixth candidate is left unfetched", async () => {
		const fetchedUrls: string[] = [];
		const errorLogs: string[] = [];
		const crawlFetch: CrawlFetch = async (url) => {
			fetchedUrls.push(url);
			return new Response("gone", { status: 404 });
		};
		const fetchThumbnail = initFetchThumbnailImage({
			crawlFetch,
			logError: (message) => errorLogs.push(message),
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		});

		const result = await fetchThumbnail({
			candidates: candidatesNumbered(6),
			referer: "https://example.com/article",
		});

		expect(result.image).toBeUndefined();
		expect(fetchedUrls).toEqual(candidatesNumbered(5));
		expect(result.fetched).toEqual(candidatesNumbered(5));
		expect(errorLogs).toEqual([
			"[CrawlArticle] Thumbnail candidate cap reached: fetched 5 of 6 candidates for https://example.com/article",
		]);
	});

	it("fetches all five candidates without a cap error when there are no more than five", async () => {
		const fetchedUrls: string[] = [];
		const errorLogs: string[] = [];
		const crawlFetch: CrawlFetch = async (url) => {
			fetchedUrls.push(url);
			return new Response("gone", { status: 404 });
		};
		const fetchThumbnail = initFetchThumbnailImage({
			crawlFetch,
			logError: (message) => errorLogs.push(message),
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		});

		const result = await fetchThumbnail({
			candidates: candidatesNumbered(5),
			referer: "https://example.com/article",
		});

		expect(result.image).toBeUndefined();
		expect(fetchedUrls).toEqual(candidatesNumbered(5));
		expect(result.fetched).toEqual(candidatesNumbered(5));
		expect(errorLogs).toEqual([]);
	});

	it.each([
		{ imageAt: 3, expectedFetched: candidatesNumbered(3) },
		{ imageAt: 5, expectedFetched: candidatesNumbered(5) },
	])("stops at the image at position $imageAt of seven without a cap error", async ({ imageAt, expectedFetched }) => {
		const fetchedUrls: string[] = [];
		const errorLogs: string[] = [];
		const imageUrl = `https://example.com/candidate-${imageAt}.png`;
		const crawlFetch: CrawlFetch = async (url) => {
			fetchedUrls.push(url);
			return url === imageUrl
				? new Response(Buffer.from("png-bytes"), { status: 200, headers: { "content-type": "image/png" } })
				: new Response("gone", { status: 404 });
		};
		const fetchThumbnail = initFetchThumbnailImage({
			crawlFetch,
			logError: (message) => errorLogs.push(message),
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		});

		const result = await fetchThumbnail({
			candidates: candidatesNumbered(7),
			referer: "https://example.com/article",
		});

		expect(result.image?.url).toBe(imageUrl);
		expect(fetchedUrls).toEqual(expectedFetched);
		expect(result.fetched).toEqual(expectedFetched);
		expect(errorLogs).toEqual([]);
	});

	const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);
	const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
	const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
	const GIF_BYTES = Buffer.from("GIF89a-gif-body");

	it("accepts an og:image served as application/octet-stream when its bytes carry a PNG signature and stores the sniffed type", async () => {
		const errorLogs: string[] = [];
		const infoLogs: string[] = [];
		const crawlFetch: CrawlFetch = async () =>
			new Response(PNG_BYTES, { status: 200, headers: { "content-type": "application/octet-stream" } });
		const fetchThumbnail = initFetchThumbnailImage({
			crawlFetch,
			logError: (message) => errorLogs.push(message),
			logInfo: (message) => infoLogs.push(message),
			logThumbnailNotDelivered: () => {},
		});

		const result = await fetchThumbnail({
			candidates: ["https://cdn.example.com/social-card"],
			referer: "https://example.com/article",
		});

		expect(result.image?.contentType).toBe("image/png");
		expect(result.image?.extension).toBe(".png");
		expect(result.image?.body.equals(PNG_BYTES)).toBe(true);
		expect(result.provenUnusable).toEqual([]);
		expect(errorLogs).toEqual([]);
		expect(infoLogs).toEqual([]);
	});

	it.each([
		{ header: "text/plain", bytes: WEBP_BYTES, contentType: "image/webp", extension: ".webp" },
		{ header: "text/html", bytes: JPEG_BYTES, contentType: "image/jpeg", extension: ".jpg" },
	])(
		"accepts a $header candidate whose bytes carry a $contentType signature and stores the sniffed type",
		async ({ header, bytes, contentType, extension }) => {
			const crawlFetch: CrawlFetch = async () =>
				new Response(bytes, { status: 200, headers: { "content-type": header } });
			const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

			const result = await fetchThumbnail({
				candidates: ["https://cdn.example.com/card"],
				referer: "https://example.com/article",
			});

			expect(result.image?.contentType).toBe(contentType);
			expect(result.image?.extension).toBe(extension);
		},
	);

	it("accepts a candidate with no Content-Type header when its bytes carry a GIF signature", async () => {
		const crawlFetch: CrawlFetch = async () => new Response(GIF_BYTES, { status: 200 });
		const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

		const result = await fetchThumbnail({
			candidates: ["https://cdn.example.com/card"],
			referer: "https://example.com/article",
		});

		expect(result.image?.contentType).toBe("image/gif");
		expect(result.image?.extension).toBe(".gif");
	});

	it("keeps the declared Content-Type for an image/* header even when the bytes carry a different signature", async () => {
		const crawlFetch: CrawlFetch = async () =>
			new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
		const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

		const result = await fetchThumbnail({
			candidates: ["https://cdn.example.com/card"],
			referer: "https://example.com/article",
		});

		expect(result.image?.contentType).toBe("image/jpeg");
		expect(result.image?.extension).toBe(".jpg");
	});

	it("keeps image/svg+xml on the strength of its header alone", async () => {
		const crawlFetch: CrawlFetch = async () =>
			new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
				status: 200,
				headers: { "content-type": "image/svg+xml" },
			});
		const fetchThumbnail = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });

		const result = await fetchThumbnail({
			candidates: ["https://cdn.example.com/logo"],
			referer: "https://example.com/article",
		});

		expect(result.image?.contentType).toBe("image/svg+xml");
		expect(result.image?.extension).toBe(".svg");
	});

	it("proves a candidate unusable and logs the declared Content-Type when a non-image body carries no image signature", async () => {
		const errorLogs: string[] = [];
		const crawlFetch: CrawlFetch = async () =>
			new Response(Buffer.from("%PDF-1.4"), { status: 200, headers: { "content-type": "application/octet-stream" } });
		const fetchThumbnail = initFetchThumbnailImage({
			crawlFetch,
			logError: (message) => errorLogs.push(message),
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		});

		const result = await fetchThumbnail({
			candidates: ["https://cdn.example.com/report"],
			referer: "https://example.com/article",
		});

		expect(result.image).toBeUndefined();
		expect(result.provenUnusable).toEqual(["https://cdn.example.com/report"]);
		expect(errorLogs).toEqual([
			'[CrawlArticle] Thumbnail unexpected Content-Type "application/octet-stream" for https://cdn.example.com/report',
		]);
	});

	it("rejects an oversized declared body before reading it, whatever the Content-Type", async () => {
		const errorLogs: string[] = [];
		const crawlFetch: CrawlFetch = async () =>
			new Response(PNG_BYTES, {
				status: 200,
				headers: { "content-type": "application/octet-stream", "content-length": String(MAX_THUMBNAIL_BYTES + 1) },
			});
		const fetchThumbnail = initFetchThumbnailImage({
			crawlFetch,
			logError: (message) => errorLogs.push(message),
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		});

		const result = await fetchThumbnail({
			candidates: ["https://cdn.example.com/huge"],
			referer: "https://example.com/article",
		});

		expect(result.provenUnusable).toEqual(["https://cdn.example.com/huge"]);
		expect(errorLogs).toEqual([
			`[CrawlArticle] Thumbnail too large (${MAX_THUMBNAIL_BYTES + 1} bytes) for https://cdn.example.com/huge`,
		]);
	});
});
