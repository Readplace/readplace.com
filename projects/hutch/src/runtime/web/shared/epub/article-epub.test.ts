import { strFromU8, unzipSync } from "fflate";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
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

describe("initBuildArticleEpub", () => {
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
				contentHtml: `<p><img src="${embeddedSrc("4444444444444444.jpg")}"></p>`,
			}),
		).rejects.toThrow("s3 down");
	});
});

describe("epubFilename", () => {
	it("slugifies the title", () => {
		expect(epubFilename({ title: "Hello, World! 2026", articleUrl: ARTICLE_URL })).toBe(
			"hello-world-2026.epub",
		);
	});

	it("falls back to the host slug when the title has no ascii letters", () => {
		expect(epubFilename({ title: "日本語", articleUrl: "https://news.example.com/x" })).toBe(
			"news-example-com.epub",
		);
	});
});
