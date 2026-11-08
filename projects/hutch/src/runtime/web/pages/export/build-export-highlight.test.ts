import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { toExportHighlights } from "./build-export-highlight";

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

describe("toExportHighlights", () => {
	it("groups highlights by the article they belong to", () => {
		const exported = toExportHighlights([
			aHighlight({ highlightOf: "example.com/a", exact: "first" }),
			aHighlight({ highlightOf: "example.com/b", exact: "second" }),
			aHighlight({ highlightOf: "example.com/a", exact: "third" }),
		]);

		expect([...exported.keys()].sort()).toEqual(["example.com/a", "example.com/b"]);
		expect(exported.get("example.com/a")?.map((h) => h.quote)).toEqual(["first", "third"]);
		expect(exported.get("example.com/b")?.map((h) => h.quote)).toEqual(["second"]);
	});

	it("orders each article's highlights by their position in the article", () => {
		const exported = toExportHighlights([
			aHighlight({ exact: "late", orderKey: 40 }),
			aHighlight({ exact: "early", orderKey: 5 }),
			aHighlight({ exact: "middle", orderKey: 12 }),
		]);

		expect(exported.get("example.com/a")?.map((h) => h.quote)).toEqual(["early", "middle", "late"]);
	});

	it("exports the quote, its context, its anchor state and ISO dates", () => {
		const exported = toExportHighlights([
			aHighlight({ exact: "the quote", prefix: "pre ", suffix: " post", anchorState: "orphaned" }),
		]);

		expect(exported.get("example.com/a")).toEqual([
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

	it("leaves the note key out when the highlight has no note", () => {
		const exported = toExportHighlights([aHighlight()]).get("example.com/a");
		assert(exported, "the article must be in the map");
		const [highlight] = exported;

		expect(Object.keys(highlight)).toEqual(["quote", "prefix", "suffix", "state", "createdAt", "updatedAt"]);
	});

	it("exports the note when the highlight has one", () => {
		const exported = toExportHighlights([aHighlight({ note: "worth rereading" })]).get("example.com/a");
		assert(exported, "the article must be in the map");
		const [highlight] = exported;

		expect(highlight.note).toBe("worth rereading");
	});

	it("exports nothing when the reader has no highlights", () => {
		expect(toExportHighlights([]).size).toBe(0);
	});
});
