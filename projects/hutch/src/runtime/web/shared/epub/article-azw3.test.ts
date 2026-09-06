import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { strFromU8, unzipSync } from "fflate";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import { azw3Filename, initBuildArticleAzw3 } from "./article-azw3";

const ARTICLE_URL = "https://example.com/article";
const ID = ArticleResourceUniqueId.parse(ARTICLE_URL);
const NOW = () => new Date("2026-09-04T00:00:00.000Z");

function embeddedSrc(filename: string): string {
	return ID.toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename });
}

function readerFor(params: { store: Record<string, Uint8Array>; readFilenames: string[] }): ReadArticleImage {
	return async ({ filename }) => {
		params.readFilenames.push(filename);
		return params.store[filename];
	};
}

describe("initBuildArticleAzw3", () => {
	it("converts a Kindle-safe EPUB after reading only Kindle-supported images", async () => {
		const jpg = "1111111111111111.jpg";
		const jpeg = "2222222222222222.JPEG";
		const png = "3333333333333333.png";
		const gif = "4444444444444444.gif";
		const webp = "5555555555555555.webp";
		const avif = "6666666666666666.avif";
		const svg = "7777777777777777.svg";
		const extensionless = "8888888888888888";
		const readFilenames: string[] = [];
		const convertedEpubs: Uint8Array[] = [];
		const loggedErrors: string[] = [];
		const convertedAzw3 = new Uint8Array([65, 90, 87, 51]);
		const build = initBuildArticleAzw3({
			readArticleImage: readerFor({
				store: {
					[jpg]: new Uint8Array([1]),
					[jpeg]: new Uint8Array([2]),
					[png]: new Uint8Array([3]),
					[gif]: new Uint8Array([4]),
					[webp]: new Uint8Array([5]),
					[avif]: new Uint8Array([6]),
					[svg]: new Uint8Array([7]),
					[extensionless]: new Uint8Array([8]),
				},
				readFilenames,
			}),
			logError: (message) => loggedErrors.push(message),
			now: NOW,
			convertEpubToAzw3: async (epub) => {
				convertedEpubs.push(epub);
				return convertedAzw3;
			},
		});

		const output = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			contentHtml: [jpg, jpeg, png, gif, webp, avif, svg, extensionless]
				.map((filename) => `<img src="${embeddedSrc(filename)}">`)
				.join(""),
		});

		expect(output).toEqual(convertedAzw3);
		expect(readFilenames).toEqual([jpg, jpeg, png, gif]);
		expect(loggedErrors).toEqual([]);
		expect(convertedEpubs).toHaveLength(1);
		const epub = convertedEpubs[0];
		assert(epub, "the converter must receive one EPUB");
		const files = unzipSync(epub);
		expect(
			Object.keys(files)
				.filter((filename) => filename.startsWith("OEBPS/images/"))
				.sort(),
		).toEqual(
			[`OEBPS/images/${jpg}`, `OEBPS/images/${jpeg}`, `OEBPS/images/${png}`, `OEBPS/images/${gif}`].sort(),
		);
		const document = new DOMParser().parseFromString(
			strFromU8(files["OEBPS/content.xhtml"]),
			"text/xml",
		);
		expect(Array.from(document.querySelectorAll("img")).map((image) => image.getAttribute("src"))).toEqual([
			`images/${jpg}`,
			`images/${jpeg}`,
			`images/${png}`,
			`images/${gif}`,
		]);
	});

	it("propagates a conversion failure", async () => {
		const build = initBuildArticleAzw3({
			readArticleImage: readerFor({ store: {}, readFilenames: [] }),
			logError: () => undefined,
			now: NOW,
			convertEpubToAzw3: async () => {
				throw new Error("boko failed");
			},
		});

		await expect(
			build({ articleUrl: ARTICLE_URL, title: "The Article", contentHtml: "<p>Text</p>" }),
		).rejects.toThrow("boko failed");
	});

	it("rejects oversized HTML before it builds an EPUB or reads images", async () => {
		const readFilenames: string[] = [];
		let conversionCount = 0;
		const build = initBuildArticleAzw3({
			readArticleImage: readerFor({ store: {}, readFilenames }),
			logError: () => undefined,
			now: NOW,
			maxContentBytes: 4,
			convertEpubToAzw3: async (epub) => {
				conversionCount += 1;
				return epub;
			},
		});

		await expect(
			build({ articleUrl: ARTICLE_URL, title: "The Article", contentHtml: "12345" }),
		).rejects.toThrow("AZW3 article content exceeds 4 bytes");
		expect(readFilenames).toEqual([]);
		expect(conversionCount).toBe(0);
	});
});

describe("azw3Filename", () => {
	it("uses the EPUB filename slug with an AZW3 extension", () => {
		expect(azw3Filename({ title: "Hello, World! 2026", articleUrl: ARTICLE_URL })).toBe(
			"hello-world-2026.azw3",
		);
	});

	it("uses the article host when the title has no ascii letters", () => {
		expect(azw3Filename({ title: "日本語", articleUrl: "https://news.example.com/x" })).toBe(
			"news-example-com.azw3",
		);
	});
});
