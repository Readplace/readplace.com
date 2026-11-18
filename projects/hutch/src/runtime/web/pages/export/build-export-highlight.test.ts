import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { groupHighlightsByArticle, toExportHighlights } from "./build-export-highlight";

let idCounter = 0;
function aHighlight(overrides: Partial<Highlight> = {}): Highlight {
	idCounter += 1;
	return {
		highlightId: HighlightIdSchema.parse(`00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`),
		highlightOf: "example.com/a",
		exact: "a passage",
		prefix: "before ",
		suffix: " after",
		start: 0,
		end: 9,
		anchoredContentHash: "hash-1",
		anchorState: "anchored",
		orderKey: 0,
		createdAt: new Date("2026-11-01T10:00:00.000Z"),
		updatedAt: new Date("2026-11-02T11:30:00.000Z"),
		anchorRevision: 0,
		...overrides,
	};
}

describe("groupHighlightsByArticle", () => {
	it("groups highlights by the article they belong to", () => {
		const grouped = groupHighlightsByArticle([
			aHighlight({ highlightOf: "example.com/a", exact: "first" }),
			aHighlight({ highlightOf: "example.com/b", exact: "second" }),
			aHighlight({ highlightOf: "example.com/a", exact: "third" }),
		]);

		expect([...grouped.keys()].sort()).toEqual(["example.com/a", "example.com/b"]);
		expect(grouped.get("example.com/a")?.map((h) => h.exact)).toEqual(["first", "third"]);
		expect(grouped.get("example.com/b")?.map((h) => h.exact)).toEqual(["second"]);
	});

	it("orders each article's highlights by their position in the article", () => {
		const grouped = groupHighlightsByArticle([
			aHighlight({ exact: "late", orderKey: 40 }),
			aHighlight({ exact: "early", orderKey: 5 }),
			aHighlight({ exact: "middle", orderKey: 12 }),
		]);

		expect(grouped.get("example.com/a")?.map((h) => h.exact)).toEqual(["early", "middle", "late"]);
	});

	it("groups nothing when the reader has no highlights", () => {
		expect(groupHighlightsByArticle([]).size).toBe(0);
	});
});

describe("toExportHighlights", () => {
	it("exports the quote, its context, its anchor state and ISO dates", () => {
		const exported = toExportHighlights({
			highlights: [aHighlight({ exact: "the quote", prefix: "pre ", suffix: " post", anchorState: "orphaned" })],
			contentHash: "hash-1",
		});

		expect(exported).toEqual([
			{
				quote: "the quote",
				prefix: "pre ",
				suffix: " post",
				state: "orphaned",
				createdAt: "2026-11-01T10:00:00.000Z",
				updatedAt: "2026-11-02T11:30:00.000Z",
			},
		]);
	});

	it("exports a highlight anchored to an older version as pending", () => {
		const [highlight] = toExportHighlights({ highlights: [aHighlight()], contentHash: "hash-2" });

		expect(highlight?.state).toBe("pending");
	});

	it("exports an edited highlight with the current wording and what the reader highlighted", () => {
		const [highlight] = toExportHighlights({
			highlights: [aHighlight({ exact: "old wording", basisQuote: "new wording", anchorState: "moved" })],
			contentHash: "hash-1",
		});

		expect(highlight).toMatchObject({ quote: "new wording", highlighted: "old wording", state: "moved" });
	});

	it("leaves the note and highlighted keys out when the highlight has no note and was not edited", () => {
		const [highlight] = toExportHighlights({ highlights: [aHighlight()], contentHash: undefined });
		assert(highlight, "the highlight must be exported");

		expect(Object.keys(highlight)).toEqual(["quote", "prefix", "suffix", "state", "createdAt", "updatedAt"]);
	});

	it("exports the note when the highlight has one", () => {
		const [highlight] = toExportHighlights({ highlights: [aHighlight({ note: "worth rereading" })], contentHash: undefined });

		expect(highlight?.note).toBe("worth rereading");
	});
});
