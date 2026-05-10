import { noopLogger } from "@packages/hutch-logger";
import type { CrawlFetch } from "@packages/crawl-article";
import { initDownloadMedia } from "./download-media";
import type { PutImageObject } from "./s3-put-image-object";
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

	const downloadMedia = initDownloadMedia({
		putImageObject,
		logger: noopLogger,
		crawlFetch,
		imagesCdnBaseUrl: "https://d123.cloudfront.net",
	});

	return { downloadMedia, putImageObject, fakeFetch };
}

describe("initDownloadMedia", () => {
	it("sends the article URL as Referer so hotlink-protected origins serve the image", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		await downloadMedia({
			html: '<img src="https://hotlinkprotected.example/photo.png">',
			articleUrl: "https://hotlinkprotected.example/post",
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
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
			articleResourceUniqueId: nestedArticle,
		});

		expect(media[0].cdnUrl).toContain("example.com%252Fblog%252Fpost");
	});

	it("extracts URLs from srcset with simple entries", async () => {
		const { downloadMedia } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img srcset="https://example.com/small.png 300w, https://example.com/large.png 600w">',
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media.map((m) => m.originalUrl)).toContain("https://example.com/photo.png");
		expect(media.map((m) => m.originalUrl)).not.toContain("https://example.com/p/w_424");
	});

	it("deduplicates srcset URLs that match img src", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img src="https://example.com/photo.png" srcset="https://example.com/photo.png 1x">',
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("skips images exceeding 5MB by content-length", async () => {
		const fakeFetch = jest.fn().mockResolvedValue(createOversizedResponse());
		const { downloadMedia, putImageObject } = createDownloadMedia({ fetch: fakeFetch });

		const media = await downloadMedia({
			html: '<p><img src="https://example.com/huge.jpg"></p>',
			articleUrl: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(putImageObject).not.toHaveBeenCalled();
	});

	it("deduplicates identical image URLs", async () => {
		const { downloadMedia, fakeFetch, putImageObject } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img src="https://example.com/photo.png"><img src="https://example.com/photo.png">',
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(putImageObject).toHaveBeenCalledTimes(20);
		expect(media).toHaveLength(20);
	});

	it("skips data URLs", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		const media = await downloadMedia({
			html: '<img src="data:image/png;base64,iVBORw0KGgo=">',
			articleUrl: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(media).toHaveLength(0);
		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it("returns empty array when no images present", async () => {
		const { downloadMedia, fakeFetch } = createDownloadMedia();

		const media = await downloadMedia({
			html: "<p>Plain text article</p>",
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
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
			articleUrl: ARTICLE_URL,
			articleResourceUniqueId,
		});

		expect(putImageObject).toHaveBeenCalledWith(
			expect.objectContaining({ key: expect.stringMatching(/\.bin$/) }),
		);
	});
});
