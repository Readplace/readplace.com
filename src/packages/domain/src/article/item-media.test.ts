import { ItemMediaSchema, offersEpubDownload } from "./item-media";
import { ReaderArticleHashId } from "./reader-article-hash-id";

describe("ItemMediaSchema", () => {
	const routeId = ReaderArticleHashId.from("https://uploads.readplace.invalid/item-1").value;

	it("parses a book with its route id and section count", () => {
		const media = ItemMediaSchema.parse({ kind: "book", fileName: "dune.epub", routeId, sectionCount: 12 });

		expect(media.kind).toBe("book");
		expect(media.fileName).toBe("dune.epub");
		expect(media.routeId.value).toBe(routeId);
		expect(media.sectionCount).toBe(12);
	});

	it("parses a book whose sections are not recorded yet", () => {
		const media = ItemMediaSchema.parse({ kind: "book", fileName: "dune.epub", routeId });

		expect(media.sectionCount).toBeUndefined();
	});

	it("refuses a negative section count", () => {
		const result = ItemMediaSchema.safeParse({ kind: "book", fileName: "dune.epub", routeId, sectionCount: -1 });

		expect(result.success).toBe(false);
	});

	it("refuses a route id that is not a reader hash", () => {
		const result = ItemMediaSchema.safeParse({ kind: "book", fileName: "dune.epub", routeId: "not-a-hash" });

		expect(result.success).toBe(false);
	});
});

describe("offersEpubDownload", () => {
	it("offers the download for a link and for a book upload", () => {
		expect(offersEpubDownload({})).toBe(true);
		expect(offersEpubDownload({ media: { kind: "book" } })).toBe(true);
	});

	it.each(["audio", "video"] as const)("withholds it for a %s upload", (kind) => {
		expect(offersEpubDownload({ media: { kind } })).toBe(false);
	});
});
