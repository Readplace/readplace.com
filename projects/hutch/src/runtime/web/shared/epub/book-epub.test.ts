import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { DOMParser } from "linkedom";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { type BookChapter, initBuildBookEpub } from "./book-epub";

const MODIFIED_AT = new Date("2026-10-12T08:30:00.000Z");
const FIRST_URL = "https://example.com/first";
const SECOND_URL = "https://example.org/second";

function imageSrc(input: { articleUrl: string; filename: string }): string {
	return ArticleResourceUniqueId.parse(input.articleUrl).toImageCdnUrl({
		baseUrl: "https://cdn.readplace.test",
		filename: input.filename,
	});
}

function chapter(input: Partial<BookChapter> & { articleUrl: string }): BookChapter {
	return {
		title: "Untitled",
		siteName: "Example",
		excerpt: "",
		summary: undefined,
		contentHtml: "<p>Body.</p>",
		...input,
	};
}

function imgSrcsOf(xhtml: string): string[] {
	const document = new DOMParser().parseFromString(xhtml, "text/xml");
	return Array.from(document.querySelectorAll("img"), (img) => String(img.getAttribute("src")));
}

describe("initBuildBookEpub", () => {
	it("sets each article in its own chapter, in the given order, each opening with that article's front matter", async () => {
		const store = initInMemoryArticleStore();
		const build = initBuildBookEpub({ readArticleImage: store.readArticleImage, maxImageBytes: 1_000 });

		const files = unzipSync(
			await build({
				title: "Waiting in your readlist — Oct 12, 2026",
				identifier: "urn:readplace:queue-digest:send-1",
				modifiedAt: MODIFIED_AT,
				chapters: [
					chapter({ articleUrl: SECOND_URL, title: "Second saved", siteName: "example.org", contentHtml: "<p>Second body.</p>" }),
					chapter({ articleUrl: FIRST_URL, title: "First saved", siteName: "example.com", contentHtml: "<p>First body.</p>" }),
				],
			}),
		);

		const outline = ["OEBPS/chapter-01.xhtml", "OEBPS/chapter-02.xhtml"].map((path) => {
			const file = files[path];
			assert(file, `${path} must be in the book`);
			const body = new DOMParser().parseFromString(strFromU8(file), "text/xml").querySelector("body");
			assert(body, `${path} must carry a body`);
			return Array.from(body.children, (element) => element.textContent);
		});
		expect(outline).toEqual([
			["Second saved", "example.org", "", "Second body."],
			["First saved", "example.com", "", "First body."],
		]);
		const opf = strFromU8(files["OEBPS/content.opf"]);
		expect(opf).toContain("<dc:title>Waiting in your readlist — Oct 12, 2026</dc:title>");
		expect(opf).toContain('<dc:identifier id="pub-id">urn:readplace:queue-digest:send-1</dc:identifier>');
		expect(opf).toContain('<meta property="dcterms:modified">2026-10-12T08:30:00Z</meta>');
	});

	it("keeps two articles' same-named images apart, each chapter pointing at its own", async () => {
		const store = initInMemoryArticleStore();
		const filename = "abcdef0123456789.png";
		await store.writeImage({ url: FIRST_URL, filename, body: Buffer.from([1]), contentType: "image/png" });
		await store.writeImage({ url: SECOND_URL, filename, body: Buffer.from([2]), contentType: "image/png" });
		const build = initBuildBookEpub({ readArticleImage: store.readArticleImage, maxImageBytes: 1_000 });

		const files = unzipSync(
			await build({
				title: "Book",
				identifier: "book",
				modifiedAt: MODIFIED_AT,
				chapters: [FIRST_URL, SECOND_URL].map((articleUrl) =>
					chapter({ articleUrl, contentHtml: `<p><img src="${imageSrc({ articleUrl, filename })}" /></p>` }),
				),
			}),
		);

		expect(files[`OEBPS/images/01/${filename}`]).toEqual(new Uint8Array([1]));
		expect(files[`OEBPS/images/02/${filename}`]).toEqual(new Uint8Array([2]));
		expect(imgSrcsOf(strFromU8(files["OEBPS/chapter-01.xhtml"]))).toEqual([`images/01/${filename}`]);
		expect(imgSrcsOf(strFromU8(files["OEBPS/chapter-02.xhtml"]))).toEqual([`images/02/${filename}`]);
	});

	it("fills one image budget across the whole book in article order, dropping an image that overflows while a later smaller one still fits", async () => {
		const store = initInMemoryArticleStore();
		const images = [
			{ articleUrl: FIRST_URL, filename: "1111111111111111.jpg", bytes: 6 },
			{ articleUrl: SECOND_URL, filename: "2222222222222222.jpg", bytes: 6 },
			{ articleUrl: SECOND_URL, filename: "3333333333333333.jpg", bytes: 3 },
		];
		for (const image of images) {
			await store.writeImage({
				url: image.articleUrl,
				filename: image.filename,
				body: Buffer.alloc(image.bytes),
				contentType: "image/jpeg",
			});
		}
		const build = initBuildBookEpub({ readArticleImage: store.readArticleImage, maxImageBytes: 10 });

		const files = unzipSync(
			await build({
				title: "Book",
				identifier: "book",
				modifiedAt: MODIFIED_AT,
				chapters: [FIRST_URL, SECOND_URL].map((articleUrl) =>
					chapter({
						articleUrl,
						contentHtml: images
							.filter((image) => image.articleUrl === articleUrl)
							.map((image) => `<p>Text for ${image.filename}</p><img src="${imageSrc(image)}" />`)
							.join(""),
					}),
				),
			}),
		);

		expect(Object.keys(files).filter((path) => path.startsWith("OEBPS/images/"))).toEqual([
			"OEBPS/images/01/1111111111111111.jpg",
			"OEBPS/images/02/3333333333333333.jpg",
		]);
		const second = strFromU8(files["OEBPS/chapter-02.xhtml"]);
		expect(imgSrcsOf(second)).toEqual(["images/02/3333333333333333.jpg"]);
		expect(second).toContain("<p>Text for 2222222222222222.jpg</p>");
	});

	it("builds the book without a stored image whose format an EPUB cannot carry", async () => {
		const store = initInMemoryArticleStore();
		const build = initBuildBookEpub({ readArticleImage: store.readArticleImage, maxImageBytes: 1_000 });
		const unsupported = imageSrc({ articleUrl: FIRST_URL, filename: "6666666666666666.bin" });

		const files = unzipSync(
			await build({
				title: "Book",
				identifier: "book",
				modifiedAt: MODIFIED_AT,
				chapters: [chapter({ articleUrl: FIRST_URL, contentHtml: `<p>Kept text.</p><img src="${unsupported}" />` })],
			}),
		);

		const xhtml = strFromU8(files["OEBPS/chapter-01.xhtml"]);
		expect(imgSrcsOf(xhtml)).toEqual([]);
		expect(xhtml).toContain("<p>Kept text.</p>");
	});

	it("refuses to build a book when an article's image is missing from the store, naming the image", async () => {
		const store = initInMemoryArticleStore();
		const build = initBuildBookEpub({ readArticleImage: store.readArticleImage, maxImageBytes: 1_000 });
		const filename = "4444444444444444.jpg";

		await expect(
			build({
				title: "Book",
				identifier: "book",
				modifiedAt: MODIFIED_AT,
				chapters: [chapter({ articleUrl: FIRST_URL, contentHtml: `<img src="${imageSrc({ articleUrl: FIRST_URL, filename })}" />` })],
			}),
		).rejects.toThrow(`[BookEpub] image ${filename} of ${FIRST_URL} is missing from the store`);
	});

	it("refuses to build a book when reading an image fails", async () => {
		const build = initBuildBookEpub({
			readArticleImage: async () => {
				throw new Error("S3 unavailable");
			},
			maxImageBytes: 1_000,
		});

		await expect(
			build({
				title: "Book",
				identifier: "book",
				modifiedAt: MODIFIED_AT,
				chapters: [
					chapter({
						articleUrl: FIRST_URL,
						contentHtml: `<img src="${imageSrc({ articleUrl: FIRST_URL, filename: "5555555555555555.jpg" })}" />`,
					}),
				],
			}),
		).rejects.toThrow("S3 unavailable");
	});

	it("builds the same bytes when the same book is built again later", async () => {
		const store = initInMemoryArticleStore();
		const build = initBuildBookEpub({ readArticleImage: store.readArticleImage, maxImageBytes: 1_000 });
		const book = {
			title: "Book",
			identifier: "book",
			modifiedAt: MODIFIED_AT,
			chapters: [chapter({ articleUrl: FIRST_URL })],
		};

		expect(await build(book)).toEqual(await build(book));
	});
});
