import assert from "node:assert/strict";
import { type AnchorState, type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import type { ReaderHighlightState } from "../article-body/reader-slot/mark-highlights";
import { highlightsXhtml } from "./highlights-xhtml";

function stateOf(input: {
	id: string;
	exact: string;
	orderKey: number;
	note?: string;
	anchorState?: AnchorState;
}): ReaderHighlightState {
	const highlight: Highlight = {
		highlightId: HighlightIdSchema.parse(input.id),
		highlightOf: "example.com/post",
		exact: input.exact,
		prefix: "",
		suffix: "",
		start: 0,
		end: input.exact.length,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: input.orderKey,
		...(input.note === undefined ? {} : { note: input.note }),
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
	};
	return {
		highlight,
		anchor: { start: 0, end: input.exact.length, anchorState: input.anchorState ?? "anchored" },
	};
}

const FIRST_ID = "0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const SECOND_ID = "1c9a7d2f-3e4b-4c6d-9e0f-1a2b3c4d5e6f";

function sectionOf(xhtml: string): Element {
	const { document } = parseHTML(`<!DOCTYPE html><html><body><div id="section">${xhtml}</div></body></html>`);
	const root = document.querySelector("div#section");
	assert(root);
	return root;
}

describe("highlightsXhtml", () => {
	it("is empty without highlights", () => {
		expect(highlightsXhtml([])).toBe("");
	});

	it("heads the section and lists quotes in orderKey order", () => {
		const root = sectionOf(
			highlightsXhtml([
				stateOf({ id: SECOND_ID, exact: "Second passage", orderKey: 20 }),
				stateOf({ id: FIRST_ID, exact: "First passage", orderKey: 10 }),
			]),
		);

		expect(Array.from(root.children, (child) => [child.localName, child.textContent])).toEqual([
			["h2", "Highlights"],
			["blockquote", "First passage"],
			["blockquote", "Second passage"],
		]);
	});

	it("follows a quote with its note", () => {
		const root = sectionOf(highlightsXhtml([stateOf({ id: FIRST_ID, exact: "A passage", orderKey: 0, note: "My thought" })]));
		const blockquote = root.querySelector("blockquote");
		assert(blockquote);

		expect(blockquote.nextElementSibling?.localName).toBe("p");
		expect(blockquote.nextElementSibling?.textContent).toBe("My thought");
	});

	it("puts nothing after a quote without a note", () => {
		expect(highlightsXhtml([stateOf({ id: FIRST_ID, exact: "A passage", orderKey: 0 })])).toBe(
			"<h2>Highlights</h2><blockquote><p>A passage</p></blockquote>",
		);
	});

	it("gives each block of a quote its own paragraph", () => {
		const root = sectionOf(highlightsXhtml([stateOf({ id: FIRST_ID, exact: "first\nsecond", orderKey: 0 })]));

		expect(Array.from(root.querySelectorAll("blockquote > p"), (p) => p.textContent)).toEqual(["first", "second"]);
	});

	it("suffixes an orphan's quote after its last block", () => {
		const root = sectionOf(
			highlightsXhtml([stateOf({ id: FIRST_ID, exact: "Gone\npassage", orderKey: 0, anchorState: "orphaned" })]),
		);

		expect(Array.from(root.querySelectorAll("blockquote > p"), (p) => p.textContent)).toEqual([
			"Gone",
			"passage (not found in the current version)",
		]);
	});

	it("escapes markup in quotes and notes", () => {
		const xhtml = highlightsXhtml([stateOf({ id: FIRST_ID, exact: "a <b> & c", orderKey: 0, note: "<script>x</script> & y" })]);

		expect(xhtml).toBe(
			"<h2>Highlights</h2><blockquote><p>a &lt;b&gt; &amp; c</p></blockquote><p>&lt;script&gt;x&lt;/script&gt; &amp; y</p>",
		);
	});
});
