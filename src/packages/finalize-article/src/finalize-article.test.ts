import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ParseHtml } from "@packages/article-parser";
import { initFetchThumbnailImage, type CrawlFetch, type FetchThumbnailImage, type ThumbnailImage } from "@packages/crawl-article";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
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
	fetched: candidates,
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

describe("initFinalizeArticle — a crawl that landed somewhere else", () => {
	const WRAPPER_URL = "https://wrapper.example/links/23045/8babea547d";
	const DESTINATION_URL = "https://dest.example/quake_shareware_cd/index.html";

	it("resolves a relative og:image against the document url, not the identity url", async () => {
		const parseHtml = jest.fn(stubParseHtml);
		const finalize = createFinalize({ parseHtml });
		const html = `<html><head>
			<meta property="og:image" content="images/hero.png">
		</head><body><p>Body</p></body></html>`;

		await finalize({ url: WRAPPER_URL, documentUrl: DESTINATION_URL, html });

		expect(parseHtml).toHaveBeenCalledWith({
			url: WRAPPER_URL,
			documentUrl: DESTINATION_URL,
			html,
			thumbnailUrl: "https://dest.example/quake_shareware_cd/images/hero.png",
		});
	});

	it("cites the document url as the thumbnail referer, which same-origin hotlink protection requires", async () => {
		const fetchThumbnailImage = jest.fn(noopFetchThumbnailImage);
		const finalize = createFinalize({ fetchThumbnailImage });
		const html = `<html><head>
			<meta property="og:image" content="images/hero.png">
		</head><body><p>Body</p></body></html>`;

		await finalize({ url: WRAPPER_URL, documentUrl: DESTINATION_URL, html });

		expect(fetchThumbnailImage).toHaveBeenCalledWith({
			candidates: ["https://dest.example/quake_shareware_cd/images/hero.png"],
			referer: DESTINATION_URL,
		});
	});

	it("keys stored images by the identity url even when the crawl redirected", async () => {
		const storedKeys: string[] = [];
		const putImageObject: PutImageObject = async ({ key }) => {
			storedKeys.push(key);
		};
		const hostedImage: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://dest.example/quake_shareware_cd/images/hero.png",
			extension: ".jpg",
		};
		const finalize = createFinalize({ putImageObject });

		const result = await finalize({
			url: WRAPPER_URL,
			documentUrl: DESTINATION_URL,
			html: "<html><body><p>Body</p></body></html>",
			resolvedThumbnail: { image: hostedImage, provenUnusable: [], fetched: [hostedImage.url] },
		});

		const identityId = ArticleResourceUniqueId.parse(WRAPPER_URL);
		const filename = `${createHash("sha256").update(hostedImage.url).digest("hex").slice(0, 16)}.jpg`;
		expect(storedKeys).toEqual([identityId.toS3ImageKey(filename)]);
		assert(result.ok);
		expect(result.article.metadata.imageUrl).toBe(
			identityId.toImageCdnUrl({ baseUrl: "https://cdn.example.com", filename }),
		);
	});

	it("hands downloadMedia the document url as referer while keying uploads by the identity url", async () => {
		const downloadMedia = jest.fn(noopDownloadMedia);
		const finalize = createFinalize({ downloadMedia });

		await finalize({
			url: WRAPPER_URL,
			documentUrl: DESTINATION_URL,
			html: "<html><body><p>Body</p></body></html>",
		});

		expect(downloadMedia).toHaveBeenCalledWith({
			html: expect.any(String),
			referer: DESTINATION_URL,
			articleResourceUniqueId: ArticleResourceUniqueId.parse(WRAPPER_URL),
		});
	});

	it("detects a bare-image capture when the crawl redirected to the image itself", async () => {
		const parseHtml = jest.fn(stubParseHtml);
		const IMAGE_DESTINATION = "https://dest.example/photo.jpg";
		const finalize = createFinalize({ parseHtml });

		const result = await finalize({
			url: WRAPPER_URL,
			documentUrl: IMAGE_DESTINATION,
			html: `<html><head><title>photo.jpg</title></head><body><img src="${IMAGE_DESTINATION}"></body></html>`,
		});

		expect(parseHtml).not.toHaveBeenCalled();
		assert(result.ok);
		expect(result.article.metadata.imageUrl).toBe(IMAGE_DESTINATION);
	});
});

describe("initFinalizeArticle", () => {
	it("returns ok:false with the parser's reason when parseHtml fails", async () => {
		const finalize = createFinalize({
			parseHtml: () => ({ ok: false, reason: "readability crashed" }),
		});

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html: "<html></html>" });

		expect(result).toEqual({ ok: false, reason: "readability crashed" });
	});

	it("extracts og:image from the html and passes it to parseHtml as thumbnailUrl", async () => {
		const parseHtml = jest.fn(stubParseHtml);
		const finalize = createFinalize({ parseHtml });
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og.png">
		</head><body><p>Body</p></body></html>`;

		await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

		expect(parseHtml).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			documentUrl: URL_UNDER_TEST,
			html,
			thumbnailUrl: "https://example.com/og.png",
		});
	});

	it("passes thumbnailUrl=null to parseHtml when the html exposes no image candidates", async () => {
		const parseHtml = jest.fn(stubParseHtml);
		const finalize = createFinalize({ parseHtml });
		const html = `<html><head><title>No images</title></head><body><p>Body</p></body></html>`;

		await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

		expect(parseHtml).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			documentUrl: URL_UNDER_TEST,
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

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html, resolvedThumbnail: { image: resolvedImage, provenUnusable: [], fetched: [resolvedImage.url] } });

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
		const fetchThumbnailImage = jest.fn().mockResolvedValue({ image: fetchedThumbnail, provenUnusable: [], fetched: [fetchedThumbnail.url] });
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ fetchThumbnailImage, putImageObject });
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og.jpg">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

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
			fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [], fetched: ["https://example.com/og.jpg"] }),
		});
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og.jpg">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

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
				fetched: ["https://example.com/not-an-image", "https://example.com/maybe.png"],
			}),
		});
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/not-an-image">
			<meta name="twitter:image" content="https://example.com/maybe.png">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

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
				fetched: ["https://example.com/not-an-image"],
			}),
		});
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/not-an-image">
		</head><body><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toBeUndefined();
		}
	});

	describe("a walk that stopped at the candidate cap", () => {
		const candidates = Array.from({ length: 7 }, (_, index) => `https://example.com/candidate-${index + 1}.png`);
		const firstFive = candidates.slice(0, 5);
		const html = `<html><body><p>Body</p>${candidates.map((candidate) => `<img src="${candidate}">`).join("")}</body></html>`;
		const cappedWalk = { image: undefined, provenUnusable: firstFive, fetched: firstFive };

		it("stores no thumbnail rather than a candidate the walk never fetched", async () => {
			const parseHtml = jest.fn(stubParseHtml);
			const finalize = createFinalize({ parseHtml });

			const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html, resolvedThumbnail: cappedWalk });

			expect(parseHtml).toHaveBeenCalledWith(expect.objectContaining({ thumbnailUrl: null }));
			assert(result.ok);
			expect(result.article.metadata.imageUrl).toBeUndefined();
		});

		it("falls back to the document url for an image rather than a candidate the walk never fetched", async () => {
			const documentUrl = "https://example.com/photo.jpg";
			const finalize = createFinalize();

			const result = await finalize({ url: documentUrl, documentUrl, html, mediaType: "image", resolvedThumbnail: cappedWalk });

			assert(result.ok);
			expect(result.article.metadata.imageUrl).toBe(documentUrl);
		});
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
			documentUrl: URL_UNDER_TEST,
			html,
			resolvedThumbnail: { image: undefined, provenUnusable: ["https://example.com/not-an-image"], fetched: ["https://example.com/not-an-image", "https://example.com/maybe.png"] },
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

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html, resolvedThumbnail: { image: undefined, provenUnusable: [], fetched: ["https://example.com/og.jpg"] } });

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
			documentUrl: URL_UNDER_TEST,
			html: "<html><body></body></html>",
			resolvedThumbnail: { image: thumbnail, provenUnusable: [], fetched: [thumbnail.url] },
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

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html: "<html><body><p>Body</p></body></html>" });

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

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html: "<html></html>" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.wordCount).toBe(500);
			expect(result.article.metadata.estimatedReadTime).toBeGreaterThan(0);
		}
	});

	it("carries the publish date the parser read", async () => {
		const finalize = createFinalize({
			parseHtml: () => ({
				ok: true,
				article: {
					title: "T",
					siteName: "s",
					excerpt: "e",
					wordCount: 500,
					content: "<p>x</p>",
					publishedOn: "2025-10-08",
				},
			}),
		});

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html: "<html></html>" });

		assert(result.ok, "the dated article finalizes");
		assert.equal(result.article.metadata.publishedOn, "2025-10-08");
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
			documentUrl: "https://example.com/lean-engineering-638.jpg",
			html: "<figure><img src=\"https://example.com/lean-engineering-638.jpg\" alt=\"\"></figure>",
			mediaType: "image",
			resolvedThumbnail: { image: resolvedImage, provenUnusable: [], fetched: [resolvedImage.url] },
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
			expect(result.article.metadata.directResourceKind).toBe("image");
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
		const fetchThumbnailImage = jest.fn().mockResolvedValue({ image: fetched, provenUnusable: [], fetched: [fetched.url] });
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ parseHtml, fetchThumbnailImage, putImageObject });
		const html = `<html><head><title>photo.jpg (638×359)</title></head><body><img src="https://example.com/photo.jpg"></body></html>`;

		const result = await finalize({ url: "https://example.com/photo.jpg", documentUrl: "https://example.com/photo.jpg", html });

		expect(parseHtml).not.toHaveBeenCalled();
		expect(fetchThumbnailImage).toHaveBeenCalledWith({
			candidates: ["https://example.com/photo.jpg"],
			referer: "https://example.com/photo.jpg",
		});
		expect(putImageObject).toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.wordCount).toBe(0);
			expect(result.article.metadata).not.toHaveProperty("directResourceKind");
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
		const fetchThumbnailImage = jest.fn().mockResolvedValue({ image: fetched, provenUnusable: [], fetched: [fetched.url] });
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const finalize = createFinalize({ parseHtml, fetchThumbnailImage, putImageObject });
		const html = `<html><head><title>F1ab (638×359)</title></head><body><img src="https://example.com/media/F1ab?format=jpg"></body></html>`;

		const result = await finalize({ url: "https://example.com/media/F1ab?format=jpg", documentUrl: "https://example.com/media/F1ab?format=jpg", html });

		expect(parseHtml).not.toHaveBeenCalled();
		expect(fetchThumbnailImage).toHaveBeenCalledWith({
			candidates: ["https://example.com/media/F1ab?format=jpg"],
			referer: "https://example.com/media/F1ab?format=jpg",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.wordCount).toBe(0);
			expect(result.article.metadata.title).toBe("F1ab");
			expect(result.article.metadata).not.toHaveProperty("directResourceKind");
			expect(result.article.html).toMatch(
				/^<figure><img src="https:\/\/cdn\.example\.com\/content\/.+" alt="F1ab" loading="lazy"><\/figure>$/,
			);
		}
	});

	it("falls back to the origin image URL when hosting the image fails (origin blocked the fetch)", async () => {
		const finalize = createFinalize({ fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [], fetched: ["https://example.com/photo.jpg"] }) });
		const html = `<html><body><img src="https://example.com/photo.jpg"></body></html>`;

		const result = await finalize({ url: "https://example.com/photo.jpg", documentUrl: "https://example.com/photo.jpg", html, mediaType: "image" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.html).toBe(
				'<figure><img src="https://example.com/photo.jpg" alt="photo" loading="lazy"></figure>',
			);
			expect(result.article.metadata.imageUrl).toBe("https://example.com/photo.jpg");
			expect(result.article.metadata).not.toHaveProperty("directResourceKind");
			expect(result.article.metadata).not.toHaveProperty("publishedOn");
		}
	});

	it("does not re-fetch the image when the crawler already resolved it and found nothing", async () => {
		const fetchThumbnailImage = jest.fn(noopFetchThumbnailImage);
		const finalize = createFinalize({ fetchThumbnailImage });
		const html = `<html><body><img src="https://example.com/photo.jpg"></body></html>`;

		const result = await finalize({
			url: "https://example.com/photo.jpg",
			documentUrl: "https://example.com/photo.jpg",
			html,
			mediaType: "image",
			resolvedThumbnail: { image: undefined, provenUnusable: [], fetched: ["https://example.com/photo.jpg"] },
		});

		expect(fetchThumbnailImage).not.toHaveBeenCalled();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toBe("https://example.com/photo.jpg");
			expect(result.article.metadata).not.toHaveProperty("directResourceKind");
		}
	});

	it("falls back to the page URL as the <img> src when there is no image to host and no candidate", async () => {
		const finalize = createFinalize({ fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [], fetched: [] }) });

		const result = await finalize({
			url: "https://example.com/photo.jpg",
			documentUrl: "https://example.com/photo.jpg",
			html: "<html><body></body></html>",
			mediaType: "image",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.html).toBe(
				'<figure><img src="https://example.com/photo.jpg" alt="photo" loading="lazy"></figure>',
			);
			expect(result.article.metadata.imageUrl).toBe("https://example.com/photo.jpg");
			expect(result.article.metadata).not.toHaveProperty("directResourceKind");
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
			documentUrl: "https://example.com/",
			html: "<html></html>",
			mediaType: "image",
			resolvedThumbnail: { image: resolvedImage, provenUnusable: [], fetched: [resolvedImage.url] },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.title).toBe("example.com");
			expect(result.article.metadata.siteName).toBe("example.com");
			expect(result.article.metadata.excerpt).toBe("Image saved from example.com.");
		}
	});

	it.each([
		{ documentUrl: "https://images.publisher.example/photos/sunset_beach.png", title: "sunset beach", host: "images.publisher.example" },
		{ documentUrl: "https://web.archive.org/web/2024/https://images.publisher.example/x.png", title: "harbour view", host: "short.example" },
	])("names a redirected image by the page it was read from: $documentUrl", async ({ documentUrl, title, host }) => {
		const finalize = createFinalize();

		const result = await finalize({
			url: "https://short.example/harbour-view.png",
			documentUrl,
			html: "<html></html>",
			mediaType: "image",
			resolvedThumbnail: { image: { body: Buffer.from([0x89]), contentType: "image/png", url: documentUrl, extension: ".png" }, provenUnusable: [], fetched: [documentUrl] },
		});

		assert(result.ok);
		expect(result.article.metadata.title).toBe(title);
		expect(result.article.metadata.siteName).toBe(host);
		expect(result.article.metadata.excerpt).toBe(`Image saved from ${host}.`);
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

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html: "<html></html>" });

		expect(contentSeenByDownloadMedia).not.toContain(oversized);
		expect(contentSeenByDownloadMedia).toContain("real text");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.html).not.toContain(oversized);
		}
	});
});

describe("initFinalizeArticle — proven tracking endpoints", () => {
	const FACEBOOK_PIXEL = "https://www.facebook.com/tr?id=1&ev=PageView&noscript=1";
	const HOTSTAR_EVENT = "https://hspx.hotstar.com/v1/events/track/cp_page_view?pi=synthetic";
	const SEC_PIXEL = "https://www.sec.gov/akam/13/pixel_0a1b2c3d?a=synthetic";
	const TURKISH_PIXEL = "https://www.turkishairlines.com/akam/13/pixel_0a1b2c3d";
	const TRACKING_URLS = [FACEBOOK_PIXEL, HOTSTAR_EVENT, SEC_PIXEL, TURKISH_PIXEL];

	function recordingCascade(failing: readonly string[]) {
		const fetched: string[] = [];
		const crawlFetch: CrawlFetch = async (url) => {
			fetched.push(String(url));
			return failing.includes(String(url))
				? new Response("gone", { status: 404 })
				: new Response(Buffer.from("png-bytes"), { status: 200, headers: { "content-type": "image/png" } });
		};
		const fetchThumbnailImage = initFetchThumbnailImage({ crawlFetch, logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });
		return { fetched, fetchThumbnailImage };
	}

	it("walks past a failed og:image and every beacon to the article figure without requesting a beacon", async () => {
		const { fetched, fetchThumbnailImage } = recordingCascade(["https://example.com/og-broken.png"]);
		const uploaded: string[] = [];
		const putImageObject: PutImageObject = async ({ key }) => { uploaded.push(key); };
		const finalize = createFinalize({ fetchThumbnailImage, putImageObject });
		const html = `<html><head>
			<meta property="og:image" content="https://example.com/og-broken.png">
		</head><body>
			${TRACKING_URLS.map((url) => `<img src="${url.replaceAll("&", "&amp;")}" width="1" height="1">`).join("")}
			<figure><img src="https://example.com/figure.png" alt="A chart"></figure>
		</body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

		expect(fetched).toEqual(["https://example.com/og-broken.png", "https://example.com/figure.png"]);
		expect(uploaded).toHaveLength(1);
		assert(result.ok);
		expect(result.article.metadata.imageUrl).toMatch(/^https:\/\/cdn\.example\.com\/content\/.+\.png$/);
	});

	it("falls through an excluded og:image to the twitter:image for display, keeping allowed order", async () => {
		const parseHtml = jest.fn(stubParseHtml);
		const finalize = createFinalize({ parseHtml });
		const html = `<html><head>
			<meta property="og:image" content="${FACEBOOK_PIXEL.replaceAll("&", "&amp;")}">
			<meta name="twitter:image" content="https://example.com/twitter.png">
		</head><body><img src="https://example.com/figure.png"><p>Body</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

		expect(parseHtml).toHaveBeenCalledWith(expect.objectContaining({ thumbnailUrl: "https://example.com/twitter.png" }));
		assert(result.ok);
		expect(result.article.metadata.imageUrl).toBe("https://example.com/twitter.png");
	});

	it("finishes a readable text article without a thumbnail when every candidate is a beacon", async () => {
		const { fetched, fetchThumbnailImage } = recordingCascade([]);
		const parseHtml = jest.fn(stubParseHtml);
		const finalize = createFinalize({ parseHtml, fetchThumbnailImage });
		const html = `<html><head>
			<meta property="og:image" content="${SEC_PIXEL}">
		</head><body><img src="${HOTSTAR_EVENT}"><p>Readable body text.</p></body></html>`;

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html });

		expect(fetched).toEqual([]);
		expect(parseHtml).toHaveBeenCalledWith(expect.objectContaining({ thumbnailUrl: null }));
		assert(result.ok);
		expect(result.article.metadata.imageUrl).toBeUndefined();
	});
});

describe("initFinalizeArticle plain-text resources", () => {
	it("preserves literal text and whitespace without Readability or media processing", async () => {
		const plainText = '\n\t  const café = "<tag>&";\n\n    value  \n';
		const parseHtml = jest.fn(stubParseHtml);
		const downloadMedia = jest.fn(noopDownloadMedia);
		const processContent = jest.fn(noopProcessContent);
		const fetchThumbnailImage = jest.fn(noopFetchThumbnailImage);
		const putImageObject = jest.fn(noopPutImageObject);
		const finalize = createFinalize({ parseHtml, downloadMedia, processContent, fetchThumbnailImage, putImageObject });

		const result = await finalize({
			url: URL_UNDER_TEST,
			documentUrl: "https://example.com/docs/my_notes.txt",
			html: "<html><body><p>Different synthetic content</p></body></html>",
			mediaType: "plain-text",
			plainText,
		});

		assert(result.ok);
		expect(result.article.html).toBe('<pre><code>\n\t  const café = &quot;&lt;tag&gt;&amp;&quot;;\n\n    value  \n</code></pre>');
		const { document } = parseHTML(result.article.html);
		expect(document.querySelector("code")?.textContent).toBe(plainText);
		expect(document.querySelector("tag")).toBeNull();
		expect(result.article.metadata).toEqual({
			title: "my notes",
			siteName: "example.com",
			excerpt: 'const café = "<tag>&"; value',
			wordCount: 5,
			estimatedReadTime: 1,
			directResourceKind: "plain-text",
		});
		expect(parseHtml).not.toHaveBeenCalled();
		expect(downloadMedia).not.toHaveBeenCalled();
		expect(processContent).not.toHaveBeenCalled();
		expect(fetchThumbnailImage).not.toHaveBeenCalled();
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("uses the existing host title fallback and reading-time convention", async () => {
		const finalize = createFinalize();
		const plainText = "word ".repeat(239);

		const result = await finalize({ url: "https://example.com/", documentUrl: "https://example.com/", html: "", mediaType: "plain-text", plainText });

		assert(result.ok);
		expect(result.article.metadata.title).toBe("Article from example.com");
		expect(result.article.metadata.wordCount).toBe(239);
		expect(result.article.metadata.estimatedReadTime).toBe(2);
		expect(result.article.metadata.excerpt).toBe(`${"word ".repeat(48).trim()}…`);
	});

	it.each([
		{ documentUrl: "https://raw.publisher.example/", host: "raw.publisher.example" },
		{ documentUrl: "https://web.archive.org/web/2024/https://raw.publisher.example/", host: "short.example" },
	])("names redirected plain text by the page it was read from: $documentUrl", async ({ documentUrl, host }) => {
		const finalize = createFinalize();

		const result = await finalize({ url: "https://short.example/", documentUrl, html: "", mediaType: "plain-text", plainText: "text" });

		assert(result.ok);
		expect(result.article.metadata.title).toBe(`Article from ${host}`);
		expect(result.article.metadata.siteName).toBe(host);
	});

	it.each(["", "\n\t  \r\n"])("rejects empty plain-text content %j", async (plainText) => {
		const parseHtml = jest.fn(stubParseHtml);
		const finalize = createFinalize({ parseHtml });

		const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html: "<p>synthetic wrapper</p>", mediaType: "plain-text", plainText });

		expect(result).toEqual({ ok: false, reason: "Plain-text response is empty" });
		expect(parseHtml).not.toHaveBeenCalled();
	});

	it.each([
		{ url: "::invalid::", documentUrl: URL_UNDER_TEST },
		{ url: URL_UNDER_TEST, documentUrl: "::invalid::" },
	])("rejects an invalid URL for plain text: %j", async ({ url, documentUrl }) => {
		const finalize = createFinalize();

		const result = await finalize({ url, documentUrl, html: "", mediaType: "plain-text", plainText: "text" });

		expect(result).toEqual({ ok: false, reason: "Invalid URL" });
	});
});

it.each([undefined, "image"] as const)("hosts %s media under the storage row with its capture ownership", async (mediaType) => {
	const writeContext = { url: "https://archive.is/legacy", attemptId: SaveAttemptIdSchema.parse("attempt"), authorUserId: UserIdSchema.parse("author") };
	const downloadMedia = jest.fn(noopDownloadMedia);
	const putImageObject = jest.fn(noopPutImageObject);
	const finalize = createFinalize({ downloadMedia, putImageObject });
	const result = await finalize({ url: URL_UNDER_TEST, documentUrl: URL_UNDER_TEST, html: "<p>article</p>", mediaType, writeContext, resolvedThumbnail: { image: { url: "https://example.com/photo.png", body: Buffer.from("image"), contentType: "image/png", extension: ".png" }, provenUnusable: [], fetched: ["https://example.com/photo.png"] } });
	expect(result.ok).toBe(true);
	expect(putImageObject).toHaveBeenCalledWith({ key: expect.stringMatching(/^content\/archive.is%2Flegacy\/images\/attempts\/[a-f0-9]{32}\/[a-f0-9]{32}\.png$/), body: Buffer.from("image"), contentType: "image/png", writeContext });
	if (mediaType === undefined) expect(downloadMedia).toHaveBeenCalledWith({ html: expect.any(String), referer: URL_UNDER_TEST, articleResourceUniqueId: ArticleResourceUniqueId.parse(writeContext.url), writeContext });
});
