import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import { highlightsRailRowViews } from "../highlights-rail/highlights-rail.component";
import {
	renderHighlightPopoverHint,
	renderHighlightPopoverPanel,
	renderHighlightPopovers,
} from "./highlight-popover.component";

const HIGHLIGHT_ID = HighlightIdSchema.parse("66666666-6666-4666-8666-666666666666");

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function actionsOf(panel: Element): (string | null)[] {
	return Array.from(panel.querySelectorAll(".highlight-popover__actions > button"), (button) =>
		button.getAttribute("data-test-action"),
	);
}

describe("renderHighlightPopoverPanel", () => {
	it("renders one highlight's actions with its note as text behind the note hook", () => {
		const doc = parse(renderHighlightPopoverPanel({ highlightId: HIGHLIGHT_ID, note: "Kept <b>note</b>", quote: "the passage" }));
		const panel = doc.getElementById(`manage-highlight-${HIGHLIGHT_ID}`);
		assert(panel);

		assert.equal(panel.getAttribute("data-highlight-popover"), HIGHLIGHT_ID);
		assert.equal(panel.getAttribute("aria-describedby"), `manage-highlight-${HIGHLIGHT_ID}-note`);
		assert.equal(panel.querySelector("[data-highlight-note-text]")?.textContent, "Kept <b>note</b>");
		assert.deepEqual(actionsOf(panel), [
			"highlight-panel-note",
			"highlight-panel-copy",
			"highlight-panel-note-delete",
			"highlight-panel-delete",
		]);
		const note = panel.querySelector('[data-test-action="highlight-panel-note"]');
		assert.equal(note?.getAttribute("popovertarget"), `note-highlight-${HIGHLIGHT_ID}`);
		assert.equal(note?.textContent?.trim(), "Edit note");
		assert.equal(
			panel.querySelector('[data-test-action="highlight-panel-note-delete"]')?.getAttribute("form"),
			`delete-note-highlight-${HIGHLIGHT_ID}`,
		);
		assert.equal(
			panel.querySelector('[data-test-action="highlight-panel-delete"]')?.getAttribute("popovertarget"),
			`delete-highlight-${HIGHLIGHT_ID}`,
		);
	});

	it("offers Copy highlight carrying the quote as escaped text, without autofocus", () => {
		const panel = parse(
			renderHighlightPopoverPanel({ highlightId: HIGHLIGHT_ID, note: undefined, quote: `Say "<b>hi</b>" & go` }),
		).getElementById(`manage-highlight-${HIGHLIGHT_ID}`);
		assert(panel);
		const copy = panel.querySelector('[data-test-action="highlight-panel-copy"]');
		assert(copy);

		assert.equal(copy.getAttribute("data-highlight-copy"), `Say "<b>hi</b>" & go`);
		assert.equal(copy.querySelector("b"), null);
		assert.equal(copy.classList.contains("highlight-popover__copy"), true);
		assert.equal(copy.hasAttribute("autofocus"), false);
		assert.equal(copy.hasAttribute("hidden"), false);
		assert.equal(copy.textContent?.trim(), "Copy highlight");
	});

	it("offers Add note and no note block or Delete note when the highlight has no note", () => {
		const panel = parse(renderHighlightPopoverPanel({ highlightId: HIGHLIGHT_ID, note: undefined, quote: "the passage" })).getElementById(
			`manage-highlight-${HIGHLIGHT_ID}`,
		);
		assert(panel);

		assert.equal(panel.hasAttribute("aria-describedby"), false);
		assert.equal(panel.querySelector("[data-highlight-note-text]"), null);
		assert.deepEqual(actionsOf(panel), ["highlight-panel-note", "highlight-panel-copy", "highlight-panel-delete"]);
		assert.equal(panel.querySelector('[data-test-action="highlight-panel-note"]')?.textContent?.trim(), "Add note");
	});
});

describe("renderHighlightPopoverHint", () => {
	it("renders the hidden hint the highlights are described by", () => {
		const hint = parse(renderHighlightPopoverHint()).getElementById("manage-highlight-hint");

		assert.equal(hint?.hasAttribute("hidden"), true);
		assert.equal(hint?.textContent, "Opens this highlight's actions");
	});
});

describe("renderHighlightPopovers", () => {
	const SCOPE = { articleId: "abc", readlist: [], surface: [] };
	const OTHER_ID = HighlightIdSchema.parse("77777777-7777-4777-8777-777777777777");

	function highlight(highlightId: Highlight["highlightId"]): Highlight {
		return {
			highlightId,
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
		};
	}

	function rows(marked: { [id: string]: boolean }) {
		return [HIGHLIGHT_ID, OTHER_ID].map((id) => ({
			highlight: highlight(id),
			shown: { state: "anchored" as const, edited: false, quote: "beta" },
			marked: marked[id] === true,
		}));
	}

	it("renders the hint and a panel only for each highlight marked on the page", () => {
		const doc = parse(
			renderHighlightPopovers(
				highlightsRailRowViews({ rows: rows({ [HIGHLIGHT_ID]: true }), scope: SCOPE, openNote: undefined }),
			),
		);

		assert.notEqual(doc.getElementById("manage-highlight-hint"), null);
		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-highlight-popover]"), (panel) => panel.getAttribute("data-highlight-popover")),
			[HIGHLIGHT_ID],
		);
	});

	it("gives an edited highlight's panel the quote shown in this version", () => {
		const edited = [
			{
				highlight: { ...highlight(HIGHLIGHT_ID), exact: "beta" },
				shown: { state: "anchored" as const, edited: true, quote: "beta prime" },
				marked: true,
			},
		];
		const doc = parse(renderHighlightPopovers(highlightsRailRowViews({ rows: edited, scope: SCOPE, openNote: undefined })));

		assert.equal(
			doc.querySelector('[data-test-action="highlight-panel-copy"]')?.getAttribute("data-highlight-copy"),
			"beta prime",
		);
	});

	it("renders an empty container when the rows carry no form scope", () => {
		const doc = parse(
			renderHighlightPopovers(
				highlightsRailRowViews({ rows: rows({ [HIGHLIGHT_ID]: true, [OTHER_ID]: true }), scope: undefined, openNote: undefined }),
			),
		);

		assert.equal(doc.getElementById("manage-highlights")?.children.length, 0);
	});
});
