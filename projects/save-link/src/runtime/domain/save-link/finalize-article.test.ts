import type { ParseHtml } from "@packages/article-parser";
import type { FetchThumbnailImage, ThumbnailImage } from "@packages/crawl-article";
import type { PutImageObject } from "../../providers/article-store/s3-put-image-object";
import type { DownloadMedia } from "./download-media";
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
const noopFetchThumbnailImage: FetchThumbnailImage = async () => undefined;
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

	it("skips the standalone fetchThumbnailImage call when the caller supplied a preFetchedThumbnail (avoids a redundant network fetch on the SimpleCrawl path)", async () => {
		const preFetchedThumbnail: ThumbnailImage = {
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

		const result = await finalize({ url: URL_UNDER_TEST, html, preFetchedThumbnail });

		expect(fetchThumbnailImage).not.toHaveBeenCalled();
		expect(putImageObject).toHaveBeenCalledWith(expect.objectContaining({
			body: preFetchedThumbnail.body,
			contentType: "image/jpeg",
		}));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.article.metadata.imageUrl).toMatch(/^https:\/\/cdn\.example\.com\/content\/.+\.jpg$/);
		}
	});

	it("fetches the og:image cascade itself when no preFetchedThumbnail is supplied (raw-HTML and comprehensive paths)", async () => {
		const fetchedThumbnail: ThumbnailImage = {
			body: Buffer.from([0xff, 0xd8, 0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/og.jpg",
			extension: ".jpg",
		};
		const fetchThumbnailImage = jest.fn().mockResolvedValue(fetchedThumbnail);
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

	it("falls back to the parser's raw imageUrl when fetchThumbnailImage returns undefined (origin blocked the hotlinked image)", async () => {
		const finalize = createFinalize({
			fetchThumbnailImage: async () => undefined,
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
			preFetchedThumbnail: thumbnail,
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
