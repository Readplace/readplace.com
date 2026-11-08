import assert from "node:assert/strict";
import { DOMParser } from "linkedom";
import { strFromU8, unzipSync } from "fflate";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { type Highlight, HighlightIdSchema, ReaderArticleHashId, SaveAttemptIdSchema } from "@packages/domain/article";
import { describeRange } from "@packages/domain/article/highlight";
import { UserIdSchema } from "@packages/domain/user";
import { mediaFilename } from "@packages/finalize-article";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import { destinationUrl } from "../../test-helpers/article-fixtures";
import { epubFilename, initBuildArticleEpub } from "./article-epub";
import { EPUB_DOWNLOAD_RAW_BYTE_LIMIT } from "./epub-image-budget";
import { articleBody } from "@packages/test-fixtures";
import { prepareReaderContent } from "../article-body/reader-slot/reader-content";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../article-body/reader-slot/section-pages";

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

const TEXT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .";

function poorlyCompressingText(length: number): string {
	let state = 0x2545f491;
	const characters: string[] = [];
	for (let index = 0; index < length; index++) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		characters.push(TEXT_ALPHABET[(state >>> 0) & 63]);
	}
	return characters.join("");
}

function imageStore(params: { count: number; bytes: number }): Record<string, Uint8Array> {
	return Object.fromEntries(
		Array.from({ length: params.count }, (_, index) => [`${String(index).padStart(16, "0")}.jpg`, new Uint8Array(params.bytes)]),
	);
}

function imagesHtml(store: Record<string, Uint8Array>): string {
	return Object.keys(store)
		.map((filename) => `<p><img src="${embeddedSrc(filename)}"></p>`)
		.join("");
}

describe("initBuildArticleEpub", () => {
	it.each([ARTICLE_URL, "https://web.archive.org/web/20250101000000/https://example.com/article"])("embeds owned media under the stored identity %s", async (articleUrl) => {
		const body = Buffer.from([1, 2, 3]);
		const filename = mediaFilename({ sourceUrl: "https://example.com/photo.png", body, extension: ".png", writeContext: { url: articleUrl, attemptId: SaveAttemptIdSchema.parse("capture-attempt"), authorUserId: UserIdSchema.parse("alice") } });
		const imageUrl = ArticleResourceUniqueId.parse(articleUrl).toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename });
		const readArticleImage = jest.fn(readerFor({ [filename]: body }));
		const logError = jest.fn();
		const build = initBuildArticleEpub({ readArticleImage, logError, now: NOW });

		const files = unzipSync((await build({ articleUrl, title: "Article", siteName: "Example", excerpt: "", summary: undefined, contentHtml: articleBody(`<p><img src="${imageUrl}" alt="Photo"></p>`) })).bytes);

		expect(readArticleImage).toHaveBeenCalledWith({ url: articleUrl, filename });
		expect(files[`OEBPS/images/${filename}`]).toEqual(new Uint8Array(body));
		expect(strFromU8(files["OEBPS/content.xhtml"])).toContain(`<img src="images/${filename}" alt="Photo" />`);
		expect(strFromU8(files["OEBPS/content.opf"])).toContain(`href="images/${filename}" media-type="image/png"`);
		expect(logError).not.toHaveBeenCalled();
	});

	it("embeds a private item's image from its own media route", async () => {
		const articleUrl = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
		const filename = `${"ab".repeat(32)}.png`;
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({ [filename]: new Uint8Array([1, 2, 3]) }),
			logError: jest.fn(),
			now: NOW,
		});

		const { bytes } = await build({
			articleUrl,
			title: "Book",
			siteName: "Book",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<p><img src="/queue/${ReaderArticleHashId.from(articleUrl).value}/media/${filename}" alt="Plate"></p>`),
		});

		const files = unzipSync(bytes);
		expect(files[`OEBPS/images/${filename}`]).toEqual(new Uint8Array([1, 2, 3]));
		expect(strFromU8(files["OEBPS/content.xhtml"])).toContain(`<img src="images/${filename}" alt="Plate" />`);
	});

	it("embeds an available hosted image", async () => {
		const filename = "abcdef0123456789.jpg";
		const logError = jest.fn();
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({ [filename]: new Uint8Array([1, 2, 3]) }),
			logError,
			now: NOW,
		});

		const { bytes } = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<p><img src="${embeddedSrc(filename)}"></p>`),
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

		const { bytes } = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<img src="${embeddedSrc(webp)}"><img src="${embeddedSrc(avif)}"><img src="${embeddedSrc(svg)}">`),
		});

		expect(
			Object.keys(unzipSync(bytes))
				.filter((filename) => filename.startsWith("OEBPS/images/"))
				.sort(),
		).toEqual([`OEBPS/images/${webp}`, `OEBPS/images/${avif}`, `OEBPS/images/${svg}`].sort());
	});

	it("skips an image over the embed budget and reports it in the build", async () => {
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

		const result = await build({
			articleUrl: ARTICLE_URL,
			title: "t",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<p><img src="${embeddedSrc(fits)}"></p><p><img src="${embeddedSrc(over)}"></p>`),
		});

		const files = unzipSync(result.bytes);
		expect(files[`OEBPS/images/${fits}`]).toBeDefined();
		expect(files[`OEBPS/images/${over}`]).toBeUndefined();
		expect(result.skippedOverBudget).toEqual([{ filename: over, bytes: 1_000_000 }]);
		expect(result.embeddedBytes).toBe(3_000_000);
		expect(logError.mock.calls).toEqual([]);
	});

	it("drops an image that overflows while a later smaller one still fits", async () => {
		const fits = "1111111111111111.jpg";
		const over = "2222222222222222.jpg";
		const small = "3333333333333333.jpg";
		const logError = jest.fn();
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({
				[fits]: new Uint8Array(3_000_000),
				[over]: new Uint8Array(1_000_000),
				[small]: new Uint8Array(400_000),
			}),
			logError,
			now: NOW,
		});

		const result = await build({
			articleUrl: ARTICLE_URL,
			title: "t",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<p><img src="${embeddedSrc(fits)}"></p><p><img src="${embeddedSrc(over)}"></p><p><img src="${embeddedSrc(small)}"></p>`),
		});

		const files = unzipSync(result.bytes);
		expect(files[`OEBPS/images/${fits}`]).toBeDefined();
		expect(files[`OEBPS/images/${small}`]).toBeDefined();
		expect(files[`OEBPS/images/${over}`]).toBeUndefined();
		expect(result.skippedOverBudget).toEqual([{ filename: over, bytes: 1_000_000 }]);
		expect(result.embeddedBytes).toBe(3_400_000);
		expect(logError.mock.calls).toEqual([]);
	});

	it("shrinks the image budget so a large body with images stays under the base64-safe download size", async () => {
		const store = imageStore({ count: 3, bytes: 1_000_000 });
		const build = initBuildArticleEpub({ readArticleImage: readerFor(store), logError: jest.fn(), now: NOW });

		const result = await build({
			articleUrl: ARTICLE_URL,
			title: "t",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<p>${poorlyCompressingText(2_600_000)}</p>${imagesHtml(store)}`),
		});

		expect((result.bytes.length * 4) / 3).toBeLessThan(6_000_000);
		expect(result.skippedOverBudget).toHaveLength(1);
		expect(Object.keys(unzipSync(result.bytes)).filter((path) => path.startsWith("OEBPS/images/"))).toHaveLength(2);
	});

	it("keeps an EPUB whose body nears the download limit within the budgeted size", async () => {
		const store = imageStore({ count: 10, bytes: 20_000 });
		const build = initBuildArticleEpub({ readArticleImage: readerFor(store), logError: jest.fn(), now: NOW });

		const result = await build({
			articleUrl: ARTICLE_URL,
			title: "t",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<p>${poorlyCompressingText(Math.floor((EPUB_DOWNLOAD_RAW_BYTE_LIMIT - 60_000) / 0.7736))}</p>${imagesHtml(store)}`),
		});

		expect(result.bytes.length).toBeLessThanOrEqual(4_500_000);
		expect(result.embeddedBytes).toBeGreaterThan(0);
		expect(result.skippedOverBudget.length).toBeGreaterThan(0);
	});

	it("embeds every image of a short article that the large body had to drop", async () => {
		const store = imageStore({ count: 3, bytes: 1_000_000 });
		const build = initBuildArticleEpub({ readArticleImage: readerFor(store), logError: jest.fn(), now: NOW });

		const result = await build({
			articleUrl: ARTICLE_URL,
			title: "t",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<p>Short.</p>${imagesHtml(store)}`),
		});

		expect(result.skippedOverBudget).toEqual([]);
		expect(result.embeddedBytes).toBe(3_000_000);
	});

	it("skips an image missing from the store and logs it", async () => {
		const filename = "3333333333333333.jpg";
		const logError = jest.fn();
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({}),
			logError,
			now: NOW,
		});

		const result = await build({
			articleUrl: ARTICLE_URL,
			title: "t",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(`<p><img src="${embeddedSrc(filename)}"></p>`),
		});

		expect(unzipSync(result.bytes)[`OEBPS/images/${filename}`]).toBeUndefined();
		expect(logError).toHaveBeenCalledWith(expect.stringContaining(filename));
		expect(result.skippedOverBudget).toEqual([]);
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
				contentHtml: articleBody(`<p><img src="${embeddedSrc("4444444444444444.jpg")}"></p>`),
			}),
		).rejects.toThrow("s3 down");
	});

	it("opens the article with its title, site name, excerpt and summary before the body copy", async () => {
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({}),
			logError: jest.fn(),
			now: NOW,
		});

		const { bytes } = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			siteName: "example.com",
			excerpt: "Parsed blurb.",
			summary: {
				status: "ready",
				summary: "First point.\n\nSecond point.",
				excerpt: "Generated blurb.",
			},
			contentHtml: articleBody("<p>Body copy.</p>"),
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
			["hr", ""],
			["p", "Read the Web, not the Slop."],
		]);
		const files = unzipSync(bytes);
		expect(strFromU8(files["OEBPS/content.xhtml"])).toContain("<title>The Article</title>");
		expect(strFromU8(files["OEBPS/content.opf"])).toContain("<dc:title>The Article</dc:title>");
	});

	it("closes the article with the colophon after the body copy", async () => {
		const build = initBuildArticleEpub({
			readArticleImage: readerFor({}),
			logError: jest.fn(),
			now: NOW,
		});

		const { bytes } = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			siteName: "example.com",
			excerpt: "Parsed blurb.",
			summary: undefined,
			contentHtml: articleBody("<p>Body copy.</p>"),
		});

		const paragraphs = contentOutline(bytes)
			.filter(([element]) => element === "p")
			.map(([, text]) => text);
		expect(paragraphs.slice(-2)).toEqual(["Body copy.", "Read the Web, not the Slop."]);
	});
});

describe("initBuildArticleEpub with highlights", () => {
	const APP_ORIGIN = "https://readplace.com";
	const CANONICAL_HASH = "canonical-hash";
	const FIRST_ID = HighlightIdSchema.parse("0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e");
	const SECOND_ID = HighlightIdSchema.parse("1c9a7d2f-3e4b-4c6d-9e0f-1a2b3c4d5e6f");

	function servedTextOf(content: string): string {
		return prepareReaderContent({
			content: articleBody(content),
			appOrigin: APP_ORIGIN,
			url: ARTICLE_URL,
			section: { requested: undefined, readerPath: "/queue/a/view", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES },
		}).text;
	}

	function highlightOn(input: { content: string; exact: string; highlightId: Highlight["highlightId"]; orderKey: number }): Highlight {
		const text = servedTextOf(input.content);
		const start = text.indexOf(input.exact);
		assert.ok(start >= 0, `"${input.exact}" must be in the served text`);
		return {
			...describeRange({ text, start, end: start + input.exact.length }),
			highlightId: input.highlightId,
			highlightOf: "example.com/article",
			anchoredContentHash: CANONICAL_HASH,
			anchorState: "anchored",
			orderKey: input.orderKey,
			createdAt: new Date("2026-11-01T00:00:00.000Z"),
			updatedAt: new Date("2026-11-01T00:00:00.000Z"),
			anchorRevision: 0,
		};
	}

	async function chapterXhtml(params: { content: string; rows?: readonly Highlight[] }): Promise<string> {
		const build = initBuildArticleEpub({ readArticleImage: readerFor({}), logError: jest.fn(), now: NOW });
		const { bytes } = await build({
			articleUrl: ARTICLE_URL,
			title: "The Article",
			siteName: "example.com",
			excerpt: "",
			summary: undefined,
			contentHtml: articleBody(params.content),
			...(params.rows === undefined
				? {}
				: { highlighted: { highlights: { rows: params.rows, canonicalContentHash: CANONICAL_HASH }, appOrigin: APP_ORIGIN } }),
		});
		return strFromU8(unzipSync(bytes)["OEBPS/content.xhtml"]);
	}

	function bodyOf(xhtml: string) {
		const body = new DOMParser().parseFromString(xhtml, "text/xml").querySelector("body");
		assert(body, "content.xhtml must carry a body");
		return body;
	}

	function sectionEntries(body: ReturnType<typeof bodyOf>): [string, string][] {
		const headings = Array.from(body.querySelectorAll("h2"));
		const heading = headings[headings.length - 1];
		assert.equal(heading.textContent, "Highlights");
		const entries: [string, string][] = [];
		for (let sibling = heading.nextElementSibling; sibling !== null && sibling.localName !== "hr"; sibling = sibling.nextElementSibling) {
			entries.push([sibling.localName, sibling.textContent ?? ""]);
		}
		return entries;
	}

	function markIdsOf(body: ReturnType<typeof bodyOf>): (string | null)[] {
		return Array.from(body.querySelectorAll("mark[data-highlight-id]"), (mark) => mark.getAttribute("data-highlight-id"));
	}

	const CONTENT = "<p>Alpha beta gamma delta.</p><p>Epsilon zeta eta theta.</p>";

	it("marks an anchored passage and lists every highlight in a closing Highlights section", async () => {
		const anchored = { ...highlightOn({ content: CONTENT, exact: "beta gamma", highlightId: FIRST_ID, orderKey: 10 }), note: "A note" };
		const orphan = {
			...highlightOn({ content: CONTENT, exact: "zeta eta", highlightId: SECOND_ID, orderKey: 20 }),
			exact: "Words that are nowhere",
		};

		const body = bodyOf(await chapterXhtml({ content: CONTENT, rows: [orphan, anchored] }));

		expect(markIdsOf(body)).toEqual([FIRST_ID]);
		expect(body.querySelector(`mark[data-highlight-id="${FIRST_ID}"]`)?.textContent).toBe("beta gamma");
		expect(sectionEntries(body)).toEqual([
			["blockquote", "beta gamma"],
			["p", "A note"],
			["blockquote", "Words that are nowhere (not found in the current version)"],
		]);
	});

	it("mints one id for a highlight split across elements and marks each piece", async () => {
		const content = "<p>a <em>b</em> c</p>";
		const highlight = highlightOn({ content, exact: "a b c", highlightId: FIRST_ID, orderKey: 0 });

		const xhtml = await chapterXhtml({ content, rows: [highlight] });

		expect(xhtml.split(`id="highlight-${FIRST_ID}"`)).toHaveLength(2);
		expect(markIdsOf(bodyOf(xhtml)).length).toBeGreaterThan(1);
	});

	it("keeps an encoded javascript: href dead in the marked chapter", async () => {
		const content = '<p><a href="&#106;avascript:alert(1)">bad link</a> then words</p>';
		const highlight = highlightOn({ content, exact: "bad link then", highlightId: FIRST_ID, orderKey: 0 });

		const xhtml = await chapterXhtml({ content, rows: [highlight] });

		expect(xhtml).not.toMatch(/javascript/i);
		expect(markIdsOf(bodyOf(xhtml))).toContain(FIRST_ID);
	});

	it("marks and lists a highlight the fuzzy pass re-anchors after the text changed", async () => {
		const stored = highlightOn({
			content: "<p>Intro words. The quick brown fox jumps over the lazy dog today.</p>",
			exact: "quick brown fox jumps over the lazy dog",
			highlightId: FIRST_ID,
			orderKey: 0,
		});
		const content = "<p>Intro words, then more words first. The quick brown fox leaps over the lazy dog today.</p>";

		const body = bodyOf(await chapterXhtml({ content, rows: [{ ...stored, anchoredContentHash: "older-hash" }] }));

		expect(markIdsOf(body)).toContain(FIRST_ID);
		expect(sectionEntries(body)).toEqual([["blockquote", "quick brown fox jumps over the lazy dog"]]);
	});

	it("builds today's chapter when the highlight list is empty", async () => {
		expect(await chapterXhtml({ content: CONTENT, rows: [] })).toBe(await chapterXhtml({ content: CONTENT }));
	});

	it("adds no Highlights section without highlights", async () => {
		const body = bodyOf(await chapterXhtml({ content: CONTENT }));

		expect(Array.from(body.querySelectorAll("h2"), (heading) => heading.textContent)).toEqual([]);
		expect(markIdsOf(body)).toEqual([]);
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
