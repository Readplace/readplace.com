import type { CrawlFetch } from "@packages/crawl-article";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initDownloadMedia } from "./download-media";
import type { PutImageObject } from "@packages/finalize-article";
import { ArticleResourceUniqueId } from "./article-resource-unique-id";

const ARTICLE_URL = "https://example.com/article";
const articleResourceUniqueId = ArticleResourceUniqueId.parse(ARTICLE_URL);

function createPngResponse(): Response {
	const pixel = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		"base64",
	);
	return new Response(pixel, {
		status: 200,
		headers: { "content-type": "image/png", "content-length": String(pixel.length) },
	});
}

function createOversizedResponse(): Response {
	return new Response(Buffer.alloc(6_000_000), {
		status: 200,
		headers: { "content-type": "image/jpeg", "content-length": "6000000" },
	});
}

function createDownloadMedia(overrides?: { putImageObject?: PutImageObject; fetch?: jest.Mock }) {
	const putImageObject: PutImageObject = overrides?.putImageObject ?? jest.fn().mockResolvedValue(undefined);
	const fakeFetch = overrides?.fetch ?? jest.fn().mockImplementation(() => Promise.resolve(createPngResponse()));
	const crawlFetch: CrawlFetch = (url, init) => fakeFetch(url, init);

	const logError = jest.fn();
	const logImageLeftAtOrigin = jest.fn();
	const downloadMedia = initDownloadMedia({
		putImageObject,
		logError,
		logImageLeftAtOrigin,
		crawlFetch,
		imagesCdnBaseUrl: "https://d123.cloudfront.net",
	});

	return { downloadMedia, putImageObject, fakeFetch, logError, logImageLeftAtOrigin };
}

describe("initDownloadMedia", () => {
	it("sends the article URL as Referer so hotlink-protected origins serve the image", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		await downloadMedia({
			html: '<img src="https://hotlinkprotected.example/photo.png">',
			referer: "https://hotlinkprotected.example/post",
			articleResourceUniqueId,
		});

		expect(fakeFetch).toHaveBeenCalledTimes(1);
		const init = fakeFetch.mock.calls[0][1];
		expect(init.referer).toBe("https://hotlinkprotected.example/post");
	});

	it("downloads image and returns mapping with CDN URL", async () => {
		const { downloadMedia, putImageObject } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<p><img src="https://example.com/photo.png"></p>',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(1);
		expect(media[0].originalUrl).toBe("https://example.com/photo.png");
		expect(media[0].cdnUrl).toMatch(/https:\/\/d123\.cloudfront\.net\/content\//);
		expect(media[0].cdnUrl).toMatch(/\.png$/);
		expect(putImageObject).toHaveBeenCalledWith(
			expect.objectContaining({
				key: expect.stringContaining("images/"),
				contentType: "image/png",
			}),
		);
	});

	it("encodes article path in S3 key to keep flat structure", async () => {
		const { downloadMedia, putImageObject } = createDownloadMedia();
		const nestedArticle = ArticleResourceUniqueId.parse("https://example.com/blog/post/");

		await downloadMedia({
			html: '<img src="https://example.com/photo.png">',
			referer: ARTICLE_URL,
			articleResourceUniqueId: nestedArticle,
		});

		expect(putImageObject).toHaveBeenCalledWith(
			expect.objectContaining({
				key: expect.stringContaining("content/example.com%2Fblog%2Fpost%2F/images/"),
			}),
		);
	});

	it("double-encodes article path in CDN URL so S3 decodes to correct key", async () => {
		const { downloadMedia } = createDownloadMedia();
		const nestedArticle = ArticleResourceUniqueId.parse("https://example.com/blog/post/");

		const media = await downloadMedia({
			html: '<img src="https://example.com/photo.png">',
			referer: ARTICLE_URL,
			articleResourceUniqueId: nestedArticle,
		});

		expect(media[0].cdnUrl).toContain("example.com%252Fblog%252Fpost");
	});

	it("extracts URLs from srcset with simple entries", async () => {
		const { downloadMedia } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img srcset="https://example.com/small.png 300w, https://example.com/large.png 600w">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(2);
		expect(media.map((m) => m.originalUrl)).toContain("https://example.com/small.png");
		expect(media.map((m) => m.originalUrl)).toContain("https://example.com/large.png");
	});

	it("extracts URLs from srcset containing commas in CDN paths", async () => {
		const { downloadMedia } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img srcset="https://cdn.example.com/image/fetch/w_424,c_limit,f_webp,q_auto:good/photo.png 424w, https://cdn.example.com/image/fetch/w_848,c_limit,f_webp,q_auto:good/photo.png 848w">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(2);
		expect(media[0].originalUrl).toBe("https://cdn.example.com/image/fetch/w_424,c_limit,f_webp,q_auto:good/photo.png");
		expect(media[1].originalUrl).toBe("https://cdn.example.com/image/fetch/w_848,c_limit,f_webp,q_auto:good/photo.png");
	});

	it("skips non-image responses from broken srcset fragment URLs", async () => {
		const fakeFetch = jest.fn().mockImplementation((url: string) => {
			if (url.includes("/p/w_424")) {
				return Promise.resolve(new Response("<html>page</html>", {
					status: 200,
					headers: { "content-type": "text/html" },
				}));
			}
			return Promise.resolve(createPngResponse());
		});
		const { downloadMedia } = createDownloadMedia({ fetch: fakeFetch });

		const media = await downloadMedia({
			html: '<img src="https://example.com/photo.png"><img srcset="https://example.com/p/w_424 424w">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media.map((m) => m.originalUrl)).toContain("https://example.com/photo.png");
		expect(media.map((m) => m.originalUrl)).not.toContain("https://example.com/p/w_424");
	});

	it("deduplicates srcset URLs that match img src", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img src="https://example.com/photo.png" srcset="https://example.com/photo.png 1x">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(fakeFetch).toHaveBeenCalledTimes(1);
		expect(media).toHaveLength(1);
	});

	it("returns empty array when download fails", async () => {
		const fakeFetch = jest.fn().mockRejectedValue(new Error("Network error"));
		const { downloadMedia, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		const media = await downloadMedia({
			html: '<p><img src="https://example.com/broken.png"></p>',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("logs an origin rejection as one image-left-at-origin event naming the URL", async () => {
		const fakeFetch = jest.fn().mockRejectedValue(new Error("Network error"));
		const { downloadMedia, logError, logImageLeftAtOrigin } = createDownloadMedia({ fetch: fakeFetch });

		await downloadMedia({
			html: '<p><img src="https://example.com/broken.png"></p>',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(logImageLeftAtOrigin).toHaveBeenCalledWith({
			message: "[DownloadMedia] image left at its origin",
			url: "https://example.com/broken.png",
			name: "Error",
			reason: "Network error",
		});
		expect(logError).not.toHaveBeenCalled();
	});

	it("records a non-Error origin rejection as its string", async () => {
		const fakeFetch = jest.fn().mockRejectedValue("socket hang up");
		const { downloadMedia, logError, logImageLeftAtOrigin } = createDownloadMedia({ fetch: fakeFetch });

		await downloadMedia({
			html: '<p><img src="https://example.com/broken.png"></p>',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(logImageLeftAtOrigin).toHaveBeenCalledWith({
			message: "[DownloadMedia] image left at its origin",
			url: "https://example.com/broken.png",
			name: "unknown",
			reason: "socket hang up",
		});
		expect(logError).not.toHaveBeenCalled();
	});

	it("logs a TimeoutError from the origin at WARN, not ERROR", async () => {
		const fakeFetch = jest.fn().mockRejectedValue(
			Object.assign(new Error("no response headers within 5000ms"), { name: "TimeoutError" }),
		);
		const { downloadMedia, logError, logImageLeftAtOrigin, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		const media = await downloadMedia({
			html: '<p><img src="https://example.com/slow.png"></p>',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(logImageLeftAtOrigin).toHaveBeenCalledWith({
			message: "[DownloadMedia] image left at its origin",
			url: "https://example.com/slow.png",
			name: "TimeoutError",
			reason: "no response headers within 5000ms",
		});
		expect(logError).not.toHaveBeenCalled();
		expect(media).toHaveLength(0);
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("treats a body read that fails after the headers as the origin not delivering", async () => {
		const fakeFetch = jest.fn().mockResolvedValue(
			new Response(
				new ReadableStream({
					start(controller) {
						controller.error(new TypeError("terminated"));
					},
				}),
				{ status: 200, headers: { "content-type": "image/png" } },
			),
		);
		const { downloadMedia, logError, logImageLeftAtOrigin, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		await downloadMedia({
			html: '<p><img src="https://example.com/cut-off.png"></p>',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(logImageLeftAtOrigin).toHaveBeenCalledWith({
			message: "[DownloadMedia] image left at its origin",
			url: "https://example.com/cut-off.png",
			name: "TypeError",
			reason: "terminated",
		});
		expect(logError).not.toHaveBeenCalled();
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("keeps an S3 upload failure at ERROR even when the SDK names it TimeoutError", async () => {
		const putImageObject: PutImageObject = jest
			.fn()
			.mockRejectedValue(Object.assign(new Error("socket hang up"), { name: "TimeoutError" }));
		const { downloadMedia, logError, logImageLeftAtOrigin } = createDownloadMedia({ putImageObject });

		const media = await downloadMedia({
			html: '<img src="https://example.com/photo.png">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(logError).toHaveBeenCalledWith(
			"[DownloadMedia] failed to process image https://example.com/photo.png",
			expect.objectContaining({ name: "TimeoutError" }),
		);
		expect(logImageLeftAtOrigin).not.toHaveBeenCalled();
		expect(media).toHaveLength(0);
	});

	it("still names the failing image when the upload rejection is not an Error", async () => {
		const putImageObject: PutImageObject = jest.fn().mockRejectedValue("S3 hiccup");
		const { downloadMedia, logError } = createDownloadMedia({ putImageObject });

		await downloadMedia({
			html: '<img src="https://example.com/photo.png">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(logError).toHaveBeenCalledWith(
			"[DownloadMedia] failed to process image https://example.com/photo.png",
			undefined,
		);
	});

	it("skips images exceeding 5MB by content-length", async () => {
		const fakeFetch = jest.fn().mockResolvedValue(createOversizedResponse());
		const { downloadMedia, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		const media = await downloadMedia({
			html: '<p><img src="https://example.com/huge.jpg"></p>',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("deduplicates identical image URLs", async () => {
		const { downloadMedia, fakeFetch, putImageObject } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img src="https://example.com/photo.png"><img src="https://example.com/photo.png">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(fakeFetch).toHaveBeenCalledTimes(1);
		expect(putImageObject).toHaveBeenCalledTimes(1);
		expect(media).toHaveLength(1);
	});

	it("limits to 20 images per article", async () => {
		const { downloadMedia, putImageObject } = createDownloadMedia();

		const imgs = Array.from({ length: 25 }, (_, i) =>
			`<img src="https://example.com/img${i}.png">`,
		).join("");

		const media = await downloadMedia({
			html: imgs,
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(putImageObject).toHaveBeenCalledTimes(20);
		expect(media).toHaveLength(20);
	});

	it("mirrors every rendition of each image even when total renditions exceed the URL cap", async () => {
		const { downloadMedia } = createDownloadMedia();

		const widths = [640, 750, 828, 1080, 1200, 1920];
		const figure = (name: string) =>
			"<figure><picture>" +
			`<source type="image/webp" srcset="${widths.map((w) => `https://m.test/${name}/${w}.webp ${w}w`).join(", ")}">` +
			`<source type="image/png" srcset="${widths.map((w) => `https://m.test/${name}/${w}.png ${w}w`).join(", ")}">` +
			`<img src="https://m.test/${name}/full.png">` +
			"</picture></figure>";

		// 2 images × (6 webp + 6 png + 1 img) = 26 rendition URLs, over a per-URL cap of 20.
		const media = await downloadMedia({
			html: figure("cubicles") + figure("loop"),
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});
		const originals = media.map((m) => m.originalUrl);

		// The later figure's renditions — which a per-URL cap would drop — are all mirrored.
		for (const w of widths) {
			expect(originals).toContain(`https://m.test/loop/${w}.webp`);
			expect(originals).toContain(`https://m.test/loop/${w}.png`);
		}
		expect(originals).toContain("https://m.test/loop/full.png");
	});

	it("skips data URLs", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img src="data:image/png;base64,iVBORw0KGgo=">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it("skips data: renditions in an img srcset and still mirrors the https src", async () => {
		const { downloadMedia, fakeFetch, logError } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img src="https://example.com/a.png" srcset="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4= 1x, data:image/svg+xml;base64,PHN2Zz48L3N2Zz4= 2x">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(fakeFetch).toHaveBeenCalledTimes(1);
		expect(fakeFetch.mock.calls[0][0]).toBe("https://example.com/a.png");
		expect(media).toHaveLength(1);
		expect(logError).not.toHaveBeenCalled();
	});

	it("skips a data: placeholder in a picture source and mirrors the real renditions", async () => {
		const { downloadMedia, fakeFetch, logError } = createDownloadMedia();

		await downloadMedia({
			html: '<picture><source media="(max-width: 700px)" srcset="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7 1w"><source srcset="https://example.com/b-700.png 700w"><img src="https://example.com/b.png"></picture>',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(fakeFetch.mock.calls.map((call) => call[0])).toEqual([
			"https://example.com/b-700.png",
			"https://example.com/b.png",
		]);
		expect(logError).not.toHaveBeenCalled();
	});

	it("skips a URL-encoded data: SVG placeholder whose srcset contains commas", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		await downloadMedia({
			html: '<img srcset="data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%271024%27%20height%3D%271024%27%20viewBox%3D%270%200%201024%201024%27%3E%3Crect%20width%3D%271024%27%20height%3D%271024%27%20fill-opacity%3D%220%22%2F%3E%3C%2Fsvg%3E 1x">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it("skips an img whose src is a chrome-extension:// asset", async () => {
		const { downloadMedia, fakeFetch, logError } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img src="chrome-extension://gmpljdlgcdkljlppaekciacdmdlhfeon/images/beside-link-icon.svg">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(fakeFetch).not.toHaveBeenCalled();
		expect(media).toHaveLength(0);
		expect(logError).not.toHaveBeenCalled();
	});

	it("fetches a src whose scheme is written in upper case", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		await downloadMedia({
			html: '<img src="HTTPS://example.com/upper.png">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(fakeFetch).toHaveBeenCalledTimes(1);
		expect(fakeFetch.mock.calls[0][0]).toBe("HTTPS://example.com/upper.png");
	});

	it("returns empty array when no images present", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		const media = await downloadMedia({
			html: "<p>Plain text article</p>",
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it("excludes image from result when S3 upload fails", async () => {
		const putImageObject: PutImageObject = jest.fn().mockRejectedValue(new Error("S3 error"));
		const { downloadMedia } = createDownloadMedia({ putImageObject });

		const media = await downloadMedia({
			html: '<img src="https://example.com/photo.png">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
	});

	it("uses application/octet-stream when content-type header is missing", async () => {
		const fakeFetch = jest.fn().mockImplementation(() =>
			Promise.resolve(new Response(Buffer.from("binary"), {
				status: 200,
				headers: { "content-length": "6" },
			})),
		);
		const { downloadMedia, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		await downloadMedia({
			html: '<img src="https://example.com/unknown">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(putImageObject).toHaveBeenCalledWith(
			expect.objectContaining({ contentType: "application/octet-stream" }),
		);
	});

	it("skips when body exceeds limit even without content-length header", async () => {
		const fakeFetch = jest.fn().mockImplementation(() =>
			Promise.resolve(new Response(Buffer.alloc(6_000_000), {
				status: 200,
				headers: { "content-type": "image/jpeg" },
			})),
		);
		const { downloadMedia, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		const media = await downloadMedia({
			html: '<img src="https://example.com/huge-no-header.jpg">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("skips non-2xx responses", async () => {
		const fakeFetch = jest.fn().mockResolvedValue(
			new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } }),
		);
		const { downloadMedia, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		const media = await downloadMedia({
			html: '<img src="https://example.com/missing.png">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("derives extension from URL pathname when content-type is unknown", async () => {
		const fakeFetch = jest.fn().mockImplementation(() =>
			Promise.resolve(new Response(Buffer.from("img"), {
				status: 200,
				headers: { "content-type": "image/x-custom" },
			})),
		);
		const { downloadMedia, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		await downloadMedia({
			html: '<img src="https://example.com/photo.tiff">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(putImageObject).toHaveBeenCalledWith(
			expect.objectContaining({ key: expect.stringMatching(/\.tiff$/) }),
		);
	});

	it("uses .bin extension when content-type is unknown and URL has no extension", async () => {
		const fakeFetch = jest.fn().mockImplementation(() =>
			Promise.resolve(new Response(Buffer.from("img"), {
				status: 200,
				headers: { "content-type": "image/x-custom" },
			})),
		);
		const { downloadMedia, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		await downloadMedia({
			html: '<img src="https://example.com/image">',
			referer: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(putImageObject).toHaveBeenCalledWith(
			expect.objectContaining({ key: expect.stringMatching(/\.bin$/) }),
		);
	});
});

it("threads capture ownership into attempt-scoped body images", async () => {
	const { downloadMedia, putImageObject } = createDownloadMedia();
	const writeContext = { url: ARTICLE_URL, attemptId: SaveAttemptIdSchema.parse("attempt"), authorUserId: UserIdSchema.parse("author") };
	const result = await downloadMedia({ html: '<img src="https://example.com/photo.png">', referer: ARTICLE_URL, articleResourceUniqueId, writeContext });
	expect(result).toHaveLength(1);
	expect(putImageObject).toHaveBeenCalledWith({ key: expect.stringMatching(/^content\/example.com%2Farticle\/images\/attempts\/[a-f0-9]{64}\/[a-f0-9]{64}\.png$/), body: expect.any(Buffer), contentType: "image/png", writeContext });
});
