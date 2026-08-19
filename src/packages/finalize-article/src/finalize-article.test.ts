import type { ParseHtml } from "@packages/article-parser";
import type { FetchThumbnailImage, ThumbnailImage } from "@packages/crawl-article";
import type { DownloadMedia } from "./download-media.types";
import type { PutImageObject } from "./put-image-object.types";
import {
	initFinalizeArticle,
	type ProcessContent,
} from "./finalize-article";

const URL_UNDER_TEST = "https://example.com/article";

const stubParseHtml: ParseHtml = (params) => ({
	ok: true,
	article: {
		title: "T",
		siteName: "example.com",
		excerpt: "e",
		wordCount: 100,
		content: `<p>${params.html.length} chars</p>`,
		imageUrl: params.thumbnailUrl ?? undefined,
	},
});

const noopDownloadMedia: DownloadMedia = async () => [];
const noopProcessContent: ProcessContent = async ({ html }) => html;
const noopFetchThumbnailImage: FetchThumbnailImage = async ({ candidates }) => ({
	image: undefined,
	provenUnusable: candidates.slice(0, 0),
});
const noopPutImageObject: PutImageObject = async () => {};

function createFinalize(overrides: {
	parseHtml?: ParseHtml;
	downloadMedia?: DownloadMedia;
	processContent?: ProcessContent;
	fetchThumbnailImage?: FetchThumbnailImage;
	putImageObject?: PutImageObject;
	imagesCdnBaseUrl?: string;
} = {}) {
	return initFinalizeArticle({
		parseHtml: overrides.parseHtml ?? stubParseHtml,
		downloadMedia: overrides.downloadMedia ?? noopDownloadMedia,
		processContent: overrides.processContent ?? noopProcessContent,
		fetchThumbnailImage: overrides.fetchThumbnailImage ?? noopFetchThumbnailImage,
		putImageObject: overrides.putImageObject ?? noopPutImageObject,
		imagesCdnBaseUrl: overrides.imagesCdnBaseUrl ?? "https://cdn.example.com",
	});
}

describe("initFinalizeArticle", () => {
	it("returns ok:false with the parser's reason when parseHtml fails", async () => {
		const finalize = createFinalize({
			parseHtml: () => ({ ok: false, reason: "readability crashed" }),
		});

		const result = await finalize({ url: URL_UNDER_TEST, html: "<html></html>" });

		expect(result).toEqual({ ok: false, reason: "readability crashed" });
	});

	it("extracts og:image from the html and passes it to parseHtml as thumbnailUrl", async () => {
		const parseHtml = jest.fn(stubParseHtml);
		const finalize = createFinalize({ parseHtml });
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og.png">
		</head><body><p>Body</p></body></html>`;

		await finalize({ url: URL_UNDER_TEST, html });

		expect(parseHtml).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			html,
			thumbnailUrl: "https://example.com/og.png",
		});
	});

	it("passes thumbnailUrl=null to parseHtml when the html exposes no image candidates", async () => {
		const parseHtml = jest.fn(stubParseHtml);
		const finalize = createFinalize({ parseHtml });
		const html = `<html><head><title>No images</title></head><body><p>Body</p></body></html>`;

		await finalize({ url: URL_UNDER_TEST, html });

		expect(parseHtml).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			html,
			thumbnailUrl: null,
		});
	});

	it("skips the standalone fetchThumbnailImage call when the caller supplied a resolvedThumbnail image (avoids a redundant network fetch on the SimpleCrawl path)", async () => {
		const resolvedImage: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/og.jpg",
			extension: ".jpg",
		};
		const fetchThumbnailImage = jest.fn(noopFetchThumbnailImage);
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ fetchThumbnailImage, putImageObject });
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og.jpg">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, html, resolvedThumbnail: { image: resolvedImage, provenUnusable: [] } });

		expect(fetchThumbnailImage).not.toHaveBeenCalled();
		expect(putImageObject).toHaveBeenCalledWith(expect.objectContaining({
			body: resolvedImage.body,
			contentType: "image/jpeg",
		}));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toMatch(/^https:\/\/cdn\.example\.com\/content\/.+\.jpg$/);
		}
	});

	it("fetches the og:image cascade itself when no resolvedThumbnail is supplied (raw-HTML and comprehensive paths)", async () => {
		const fetchedThumbnail: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/og.jpg",
			extension: ".jpg",
		};
		const fetchThumbnailImage = jest.fn().mockResolvedValue({ image: fetchedThumbnail, provenUnusable: [] });
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ fetchThumbnailImage, putImageObject });
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og.jpg">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, html });

		expect(fetchThumbnailImage).toHaveBeenCalledWith({
			candidates: ["https://example.com/og.jpg"],
			referer: URL_UNDER_TEST,
		});
		expect(putImageObject).toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toMatch(/^https:\/\/cdn\.example\.com\/content\/.+\.jpg$/);
		}
	});

	it("falls back to the parser's raw imageUrl when the cascade found no image but disproved nothing (origin blocked the hotlinked image)", async () => {
		const finalize = createFinalize({
			fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }),
		});
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og.jpg">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, html });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toBe("https://example.com/og.jpg");
		}
	});

	it("does not persist a candidate the cascade proved unusable, and picks the next candidate instead", async () => {
		const finalize = createFinalize({
			fetchThumbnailImage: async () => ({
				image: undefined,
				provenUnusable: ["https://example.com/not-an-image"],
			}),
		});
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/not-an-image">
			<meta name="twitter:image" content="https://example.com/maybe.png">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, html });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toBe("https://example.com/maybe.png");
		}
	});

	it("persists no thumbnail at all when every candidate was proved unusable", async () => {
		const finalize = createFinalize({
			fetchThumbnailImage: async () => ({
				image: undefined,
				provenUnusable: ["https://example.com/not-an-image"],
			}),
		});
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/not-an-image">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, html });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toBeUndefined();
		}
	});

	it("honours the crawler's own verdicts, so a candidate it disproved is not persisted by the finalizer either", async () => {
		const fetchThumbnailImage = jest.fn(noopFetchThumbnailImage);
		const finalize = createFinalize({ fetchThumbnailImage });
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/not-an-image">
			<meta name="twitter:image" content="https://example.com/maybe.png">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({
			url: URL_UNDER_TEST,
			html,
			resolvedThumbnail: { image: undefined, provenUnusable: ["https://example.com/not-an-image"] },
		});

		expect(fetchThumbnailImage).not.toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toBe("https://example.com/maybe.png");
		}
	});

	it("does not re-fetch when the crawler already resolved the thumbnail and found nothing (no duplicate fetch on the failure path)", async () => {
		const fetchThumbnailImage = jest.fn(noopFetchThumbnailImage);
		const finalize = createFinalize({ fetchThumbnailImage });
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og.jpg">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, html, resolvedThumbnail: { image: undefined, provenUnusable: [] } });

		expect(fetchThumbnailImage).not.toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			// The crawler's cascade already failed; fall back to the raw og:image
			// URL rather than fire the identical fetch a second time.
			expect(result.article.metadata.imageUrl).toBe("https://example.com/og.jpg");
		}
	});

	it("uploads the thumbnail under a stable sha256-derived key so re-saves of the same image hit the CDN's existing entry", async () => {
		const thumbnail: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://cdn.example/identical.jpg",
			extension: ".jpg",
		};
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ putImageObject });

		const result = await finalize({
			url: URL_UNDER_TEST,
			html: "<html><body></body></html>",
			resolvedThumbnail: { image: thumbnail, provenUnusable: [] },
		});

		expect(putImageObject).toHaveBeenCalledWith(expect.objectContaining({
			key: expect.stringMatching(/^content\/.+\/images\/[0-9a-f]{16}\.jpg$/),
		}));
		expect(result.ok).toBe(true);
	});

	it("threads downloaded media through processContent so the persisted html references the CDN URLs", async () => {
		const downloadMedia: DownloadMedia = async () => [
			{ originalUrl: "https://example.com/inline.png", cdnUrl: "https://cdn.example/inline.png" },
		];
		const processContent: ProcessContent = jest.fn(async ({ media }) => {
			return media.map((m) => `<img src="${m.cdnUrl}">`).join("");
		});
		const finalize = createFinalize({ downloadMedia, processContent });

		const result = await finalize({ url: URL_UNDER_TEST, html: "<html><body><p>Body</p></body></html>" });

		expect(processContent).toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.html).toContain("https://cdn.example/inline.png");
		}
	});

	it("computes estimatedReadTime from wordCount so the metadata sidecar carries it consistently across triggers", async () => {
		const finalize = createFinalize({
			parseHtml: () => ({
				ok: true,
				article: {
					title: "T",
					siteName: "s",
					excerpt: "e",
					wordCount: 500,
					content: "<p>x</p>",
					imageUrl: undefined,
				},
			}),
		});

		const result = await finalize({ url: URL_UNDER_TEST, html: "<html></html>" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.wordCount).toBe(500);
			expect(result.article.metadata.estimatedReadTime).toBeGreaterThan(0);
		}
	});

	const throwingParseHtml = jest.fn<ReturnType<ParseHtml>, Parameters<ParseHtml>>(() => {
		throw new Error("Readability must not run for an image article");
	});

	it("hosts the pre-fetched image and stores an <img> body without running Readability (mediaType:image)", async () => {
		const resolvedImage: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/lean-engineering-638.jpg",
			extension: ".jpg",
		};
		const parseHtml = jest.fn<ReturnType<ParseHtml>, Parameters<ParseHtml>>(throwingParseHtml);
		const fetchThumbnailImage = jest.fn(noopFetchThumbnailImage);
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ parseHtml, fetchThumbnailImage, putImageObject });

		const result = await finalize({
			url: "https://example.com/lean-engineering-638.jpg",
			html: "<figure><img src=\"https://example.com/lean-engineering-638.jpg\" alt=\"\"></figure>",
			mediaType: "image",
			resolvedThumbnail: { image: resolvedImage, provenUnusable: [] },
		});

		expect(parseHtml).not.toHaveBeenCalled();
		expect(fetchThumbnailImage).not.toHaveBeenCalled();
		expect(putImageObject).toHaveBeenCalledWith(expect.objectContaining({
			body: resolvedImage.body,
			contentType: "image/jpeg",
		}));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.title).toBe("lean engineering 638");
			expect(result.article.metadata.wordCount).toBe(0);
			expect(result.article.metadata.estimatedReadTime).toBeGreaterThan(0);
			expect(result.article.metadata.imageUrl).toMatch(
				/^https:\/\/cdn\.example\.com\/content\/.+\/images\/[0-9a-f]{16}\.jpg$/,
			);
			expect(result.article.html).toMatch(
				/^<figure><img src="https:\/\/cdn\.example\.com\/content\/.+\.jpg" alt="lean engineering 638" loading="lazy"><\/figure>$/,
			);
		}
	});

	it("detects a bare-image capture (extension raw-HTML path, no mediaType) and synthesises the image article", async () => {
		const fetched: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/photo.jpg",
			extension: ".jpg",
		};
		const parseHtml = jest.fn<ReturnType<ParseHtml>, Parameters<ParseHtml>>(throwingParseHtml);
		const fetchThumbnailImage = jest.fn().mockResolvedValue({ image: fetched, provenUnusable: [] });
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ parseHtml, fetchThumbnailImage, putImageObject });
		const html = `<html><head><title>photo.jpg (638×359)</title></head><body><img src="https://example.com/photo.jpg"></body></html>`;

		const result = await finalize({ url: "https://example.com/photo.jpg", html });

		expect(parseHtml).not.toHaveBeenCalled();
		expect(fetchThumbnailImage).toHaveBeenCalledWith({
			candidates: ["https://example.com/photo.jpg"],
			referer: "https://example.com/photo.jpg",
		});
		expect(putImageObject).toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.wordCount).toBe(0);
			expect(result.article.html).toMatch(
				/^<figure><img src="https:\/\/cdn\.example\.com\/content\/.+" alt="photo" loading="lazy"><\/figure>$/,
			);
		}
	});

	it("detects an extension-less bare-image capture by its single-image document shape (no extension, no mediaType) and synthesises the image article", async () => {
		const fetched: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/media/F1ab?format=jpg",
			extension: ".jpg",
		};
		const parseHtml = jest.fn<ReturnType<ParseHtml>, Parameters<ParseHtml>>(throwingParseHtml);
		const fetchThumbnailImage = jest.fn().mockResolvedValue({ image: fetched, provenUnusable: [] });
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ parseHtml, fetchThumbnailImage, putImageObject });
		const html = `<html><head><title>F1ab (638×359)</title></head><body><img src="https://example.com/media/F1ab?format=jpg"></body></html>`;

		const result = await finalize({ url: "https://example.com/media/F1ab?format=jpg", html });

		expect(parseHtml).not.toHaveBeenCalled();
		expect(fetchThumbnailImage).toHaveBeenCalledWith({
			candidates: ["https://example.com/media/F1ab?format=jpg"],
			referer: "https://example.com/media/F1ab?format=jpg",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.wordCount).toBe(0);
			expect(result.article.metadata.title).toBe("F1ab");
			expect(result.article.html).toMatch(
				/^<figure><img src="https:\/\/cdn\.example\.com\/content\/.+" alt="F1ab" loading="lazy"><\/figure>$/,
			);
		}
	});

	it("falls back to the origin image URL when hosting the image fails (origin blocked the fetch)", async () => {
		const finalize = createFinalize({ fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }) });
		const html = `<html><body><img src="https://example.com/photo.jpg"></body></html>`;

		const result = await finalize({ url: "https://example.com/photo.jpg", html, mediaType: "image" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.html).toBe(
				'<figure><img src="https://example.com/photo.jpg" alt="photo" loading="lazy"></figure>',
			);
			expect(result.article.metadata.imageUrl).toBe("https://example.com/photo.jpg");
		}
	});

	it("does not re-fetch the image when the crawler already resolved it and found nothing", async () => {
		const fetchThumbnailImage = jest.fn(noopFetchThumbnailImage);
		const finalize = createFinalize({ fetchThumbnailImage });
		const html = `<html><body><img src="https://example.com/photo.jpg"></body></html>`;

		const result = await finalize({
			url: "https://example.com/photo.jpg",
			html,
			mediaType: "image",
			resolvedThumbnail: { image: undefined, provenUnusable: [] },
		});

		expect(fetchThumbnailImage).not.toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toBe("https://example.com/photo.jpg");
		}
	});

	it("falls back to the page URL as the <img> src when there is no image to host and no candidate", async () => {
		const finalize = createFinalize({ fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }) });

		const result = await finalize({
			url: "https://example.com/photo.jpg",
			html: "<html><body></body></html>",
			mediaType: "image",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.html).toBe(
				'<figure><img src="https://example.com/photo.jpg" alt="photo" loading="lazy"></figure>',
			);
			expect(result.article.metadata.imageUrl).toBe("https://example.com/photo.jpg");
		}
	});

	it("titles the image from the hostname when the URL has no filename segment", async () => {
		const resolvedImage: ThumbnailImage = {
			body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
			contentType: "image/png",
			url: "https://example.com/",
			extension: ".png",
		};
		const finalize = createFinalize();

		const result = await finalize({
			url: "https://example.com/",
			html: "<html></html>",
			mediaType: "image",
			resolvedThumbnail: { image: resolvedImage, provenUnusable: [] },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.title).toBe("example.com");
			expect(result.article.metadata.siteName).toBe("example.com");
			expect(result.article.metadata.excerpt).toBe("Image saved from example.com.");
		}
	});

	it("strips multi-MB inline base64 images from the body before it is persisted (#473)", async () => {
		const oversized = "A".repeat(5000);
		const parseHtml: ParseHtml = (params) => ({
			ok: true,
			article: {
				title: "T",
				siteName: "s",
				excerpt: "e",
				wordCount: 100,
				content: `<p>real text</p><img src="data:image/png;base64,${oversized}">`,
				imageUrl: params.thumbnailUrl ?? undefined,
			},
		});
		let contentSeenByDownloadMedia = "";
		const downloadMedia: DownloadMedia = async ({ html }) => {
			contentSeenByDownloadMedia = html;
			return [];
		};
		const finalize = createFinalize({ parseHtml, downloadMedia });

		const result = await finalize({ url: URL_UNDER_TEST, html: "<html></html>" });

		expect(contentSeenByDownloadMedia).not.toContain(oversized);
		expect(contentSeenByDownloadMedia).toContain("real text");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.html).not.toContain(oversized);
		}
	});
});
