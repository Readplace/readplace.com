import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { cardKindOf, hoursAndMinutesRead } from "./card-kind-label";

const minutes = (value: number) => MinutesSchema.parse(value);

function book(input: { wordCount: number; estimatedReadTime: number; sectionCount: number | undefined }) {
	return {
		media: {
			kind: "book" as const,
			fileName: "dune.epub",
			routeId: ReaderArticleHashId.from("https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef"),
			sectionCount: input.sectionCount,
		},
		metadata: { title: "Dune", siteName: "Book", excerpt: "", wordCount: input.wordCount },
		estimatedReadTime: minutes(input.estimatedReadTime),
	};
}

describe("hoursAndMinutesRead", () => {
	it.each([
		[45, "45 min read"],
		[120, "2 h read"],
		[580, "9 h 40 min read"],
	])("reads %i minutes as %s", (value, expected) => {
		expect(hoursAndMinutesRead(minutes(value))).toBe(expected);
	});
});

describe("cardKindOf", () => {
	it("labels a book with its chapters and its read time", () => {
		expect(cardKindOf(book({ wordCount: 139_200, estimatedReadTime: 580, sectionCount: 23 }))?.kindLabel).toBe(
			"Book · 23 chapters · 9 h 40 min read",
		);
	});

	it("leaves the chapters out before they are counted", () => {
		expect(cardKindOf(book({ wordCount: 139_200, estimatedReadTime: 580, sectionCount: undefined }))?.kindLabel).toBe(
			"Book · 9 h 40 min read",
		);
	});

	it("counts a single chapter in the singular", () => {
		expect(cardKindOf(book({ wordCount: 0, estimatedReadTime: 0, sectionCount: 1 }))?.kindLabel).toBe("Book · 1 chapter");
	});

	it("leaves the read time out before the words are counted", () => {
		expect(cardKindOf(book({ wordCount: 0, estimatedReadTime: 0, sectionCount: 23 }))?.kindLabel).toBe("Book · 23 chapters");
	});

	it("names the book kind with its badge icon", () => {
		expect(cardKindOf(book({ wordCount: 0, estimatedReadTime: 0, sectionCount: undefined }))?.kind).toEqual({
			name: "book",
			label: "Book",
			noun: "book",
			icon: "book",
		});
	});

	it("gives an ordinary article no kind", () => {
		const { media: _media, ...article } = book({ wordCount: 10, estimatedReadTime: 1, sectionCount: undefined });
		expect(cardKindOf(article)).toBeUndefined();
	});
});
