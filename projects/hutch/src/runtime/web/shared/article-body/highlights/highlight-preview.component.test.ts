import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import type { HighlightsRailRowState } from "../highlights-rail/highlights-rail.component";
import { renderHighlightPreviews } from "./highlight-preview.component";

function highlight(input: { id: string; note?: string }): Highlight {
	return {
		highlightId: HighlightIdSchema.parse(input.id),
		highlightOf: "https://example.com/post",
		exact: "beta",
		prefix: "",
		suffix: "",
		start: 0,
		end: 4,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: 0,
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
		...(input.note === undefined ? {} : { note: input.note }),
	};
}

const IDS = {
	anchored: "11111111-1111-4111-8111-111111111111",
	moved: "22222222-2222-4222-8222-222222222222",
	orphaned: "33333333-3333-4333-8333-333333333333",
	pending: "44444444-4444-4444-8444-444444444444",
	plain: "55555555-5555-4555-8555-555555555555",
};

describe("renderHighlightPreviews", () => {
	it("renders a preview for each anchored or moved highlight that has a note, holding the note as text", () => {
		const rows: { highlight: Highlight; state: HighlightsRailRowState }[] = [
			{ highlight: highlight({ id: IDS.anchored, note: "Anchored <b>note</b>" }), state: "anchored" },
			{ highlight: highlight({ id: IDS.moved, note: "Moved note" }), state: "moved" },
			{ highlight: highlight({ id: IDS.orphaned, note: "Lost note" }), state: "orphaned" },
			{ highlight: highlight({ id: IDS.pending, note: "Pending note" }), state: "pending" },
			{ highlight: highlight({ id: IDS.plain }), state: "anchored" },
		];

		const page = new JSDOM(renderHighlightPreviews(rows)).window.document;

		expect(
			Array.from(page.querySelectorAll("[data-highlight-preview]"), (preview) => ({
				id: preview.id,
				note: preview.textContent,
			})),
		).toEqual([
			{ id: `preview-highlight-${IDS.anchored}`, note: "Anchored <b>note</b>" },
			{ id: `preview-highlight-${IDS.moved}`, note: "Moved note" },
		]);
	});

	it("renders nothing without a noted highlight", () => {
		expect(renderHighlightPreviews([{ highlight: highlight({ id: IDS.plain }), state: "anchored" }])).toBe("");
	});
});
