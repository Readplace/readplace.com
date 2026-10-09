import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { strFromU8, unzipSync } from "fflate";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { mediaFilename } from "@packages/finalize-article";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import { destinationUrl } from "../../test-helpers/article-fixtures";
import { epubFilename, initBuildArticleEpub } from "./article-epub";

const ARTICLE_URL = "https://example.com/article";
const ID = ArticleResourceUniqueId.parse(ARTICLE_URL);
const NOW = () => new Date("2026-09-02T00:00:00.000Z");

function embeddedSrc(filename: string): string {
	return ID.toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename });
}

function readerFor(store: Record<string, Uint8Array>): ReadArticleImage {
	return async ({ filename }) => store[filename];
}

function contentOutline(epub: Uint8Array): [string, string][] {
	const xhtml = strFromU8(unzipSync(epub)["OEBPS/content.xhtml"]);
	const document = new DOMParser().parseFromString(xhtml, "text/xml");
	const body = document.querySelector("body");
	assert(body, "content.xhtml must carry a body");
	return Array.from(body.children, (element) => [element.localName, element.textContent]);
}

describe("initBuildArticleEpub", () => {
	it.each([ARTICLE_URL, "https://web.archive.org/web/20250101000000/https://example.com/article"])("embeds owned media under the stored identity %s", async (articleUrl) => {
		const body = Buffer.from([1, 2, 3]);
		const filename = mediaFilename({ sourceUrl: "https://example.com/photo.png", body, extension: ".png", writeContext: { url: articleUrl, attemptId: SaveAttemptIdSchema.parse("capture-attempt"), authorUserId: UserIdSchema.parse("alice") } });
		const imageUrl = ArticleResourceUniqueId.parse(articleUrl).toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename });
		const readArticleImage = jest.fn(readerFor({ [filename]: body }));
		const logError = jest.fn();
		const build = initBuildArticleEpub({ readArticleImage, logError, now: NOW });

		const files = unzipSync(await build({ articleUrl, title: "Article", siteName: "Example", excerpt: "", summary: undefined, contentHtml: `<p><img src="${imageUrl}" alt="Photo"></p>` }));

		expect(readArticleImage).toHaveBeenCalledWith({ url: articleUrl, filename });
		expect(files[`OEBPS/images/${filename}`]).toEqual(new Uint8Array(body));
		expect(strFromU8(files["OEBPS/content.xhtml"])).toContain(`<img src="images/${filename}" alt="Photo" />`);
		expect(strFromU8(files["OEBPS/content.opf"])).toContain(`href="images/${filename}" media-type="image/png"`);
		expect(logError).not.toHaveBeenCalled();
	});

	it("embeds an available hosted image", async () => {
		const filename = "abcdef0123456789.jpg";
		const logError = jest.fn();
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({ [filename]: new Uint8Array([1, 2, 3]) }),
			logError,
			now: NOW,
		});

		const bytes = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: `<p><img src="${embeddedSrc(filename)}"></p>`,
		});

		const files = unzipSync(bytes);
		expect(files[`OEBPS/images/${filename}`]).toEqual(new Uint8Array([1, 2, 3]));
		expect(strFromU8(files["OEBPS/content.xhtml"])).toContain(`images/${filename}`);
		expect(logError).not.toHaveBeenCalled();
	});

	it("continues to embed supported modern image formats", async () => {
		const webp = "1111111111111111.webp";
		const avif = "2222222222222222.avif";
		const svg = "3333333333333333.svg";
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({
				[webp]: new Uint8Array([1]),
				[avif]: new Uint8Array([2]),
				[svg]: new Uint8Array([3]),
			}),
			logError: () => undefined,
			now: NOW,
		});

		const bytes = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: `<img src="${embeddedSrc(webp)}"><img src="${embeddedSrc(avif)}"><img src="${embeddedSrc(svg)}">`,
		});

		expect(
			Object.keys(unzipSync(bytes))
				.filter((filename) => filename.startsWith("OEBPS/images/"))
				.sort(),
		).toEqual([`OEBPS/images/${webp}`, `OEBPS/images/${avif}`, `OEBPS/images/${svg}`].sort());
	});

	it("skips an image over the embed budget and logs it", async () => {
		const fits = "1111111111111111.jpg";
		const over = "2222222222222222.jpg";
		const logError = jest.fn();
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({
				[fits]: new Uint8Array(3_000_000),
				[over]: new Uint8Array(1_000_000),
			}),
			logError,
			now: NOW,
		});

		const bytes = await build({
			articleUrl: ARTICLE_URL,
			title: "t",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: `<p><img src="${embeddedSrc(fits)}"></p><p><img src="${embeddedSrc(over)}"></p>`,
		});

		const files = unzipSync(bytes);
		expect(files[`OEBPS/images/${fits}`]).toBeDefined();
		expect(files[`OEBPS/images/${over}`]).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(expect.stringContaining(over));
	});

	it("skips an image missing from the store and logs it", async () => {
		const filename = "3333333333333333.jpg";
		const logError = jest.fn();
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({}),
			logError,
			now: NOW,
		});

		const bytes = await build({
			articleUrl: ARTICLE_URL,
			title: "t",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: `<p><img src="${embeddedSrc(filename)}"></p>`,
		});

		expect(unzipSync(bytes)[`OEBPS/images/${filename}`]).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(expect.stringContaining(filename));
	});

	it("propagates a provider error", async () => {
		const build = initBuildArticleEpub({
			readArticleImage: async () => {
				throw new Error("s3 down");
			},
			logError: jest.fn(),
			now: NOW,
		});

		await expect(
			build({
				articleUrl: ARTICLE_URL,
				title: "t",
				siteName: "example.com",
				excerpt: "",
				summary: undefined,
				contentHtml: `<p><img src="${embeddedSrc("4444444444444444.jpg")}"></p>`,
			}),
		).rejects.toThrow("s3 down");
	});

	it("opens the article with its title, site name, excerpt and summary before the body copy", async () => {
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({}),
			logError: jest.fn(),
			now: NOW,
		});

		const bytes = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			siteName: "example.com",
			excerpt: "Parsed blurb.",
			summary: {
				status: "ready",
				summary: "First point.\n\nSecond point.",
				excerpt: "Generated blurb.",
				topics: [],
			},
			contentHtml: "<p>Body copy.</p>",
		});

		expect(contentOutline(bytes)).toEqual([
			["h1", "The Article"],
			["p", "example.com"],
			["p", "Generated blurb."],
			["h2", "Summary (TL;DR)"],
			["p", "First point."],
			["p", "Second point."],
			["hr", ""],
			["p", "Body copy."],
		]);
		const files = unzipSync(bytes);
		expect(strFromU8(files["OEBPS/content.xhtml"])).toContain("<title>The Article</title>");
		expect(strFromU8(files["OEBPS/content.opf"])).toContain("<dc:title>The Article</dc:title>");
	});
});

describe("epubFilename", () => {
	it("slugifies the title", () => {
		expect(epubFilename({ title: "Hello, World! 2026", destinationUrl: destinationUrl(ARTICLE_URL) })).toBe(
			"hello-world-2026.epub",
		);
	});

	it("falls back to the host slug when the title has no ascii letters", () => {
		expect(epubFilename({ title: "日本語", destinationUrl: destinationUrl("https://news.example.com/x") })).toBe(
			"news-example-com.epub",
		);
	});
});
