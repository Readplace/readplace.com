import assert from "node:assert/strict";
import { type AnchorState, type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import type { ReaderHighlightState } from "../article-body/reader-slot/mark-highlights";
import { highlightsXhtml, noteReferencedChapterXhtml } from "./highlights-xhtml";

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

const THIRD_ID = "2d0b8e3a-4f5c-4d7e-8f1a-2b3c4d5e6f70";
const FOURTH_ID = "3e1c9f4b-5a6d-4e8f-9a2b-3c4d5e6f7081";
const FIFTH_ID = "4f2d0a5c-6b7e-4f9a-8b3c-4d5e6f708192";

function markOf(input: { id: string; text: string; noted?: "segment" | "end" }): string {
	const classes = {
		plain: "article-highlight",
		segment: "article-highlight article-highlight--has-note",
		end: "article-highlight article-highlight--has-note article-highlight--note-end",
	}[input.noted ?? "plain"];
	return `<mark class="${classes}" data-highlight-id="${input.id}">${input.text}</mark>`;
}

function referenceOf(input: { id: string; number: number }): string {
	return `<sup><a href="#endnote-highlight-${input.id}" id="noteref-highlight-${input.id}" role="doc-noteref" epub:type="noteref">${input.number}</a></sup>`;
}

describe("noteReferencedChapterXhtml", () => {
	it("numbers marked notes in orderKey order and leaves an un-noted, an orphaned and an unmarked entry unnumbered", () => {
		const html = `<p>${markOf({ id: FIRST_ID, text: "Alpha", noted: "end" })} and ${markOf({ id: SECOND_ID, text: "beta" })} then ${markOf({ id: FIFTH_ID, text: "epsilon", noted: "end" })}.</p>`;

		const chapter = noteReferencedChapterXhtml({
			html,
			states: [
				stateOf({ id: FIRST_ID, exact: "Alpha", orderKey: 10, note: "First thought" }),
				stateOf({ id: SECOND_ID, exact: "beta", orderKey: 20 }),
				stateOf({ id: THIRD_ID, exact: "Gone", orderKey: 30, note: "Lost thought", anchorState: "orphaned" }),
				stateOf({ id: FOURTH_ID, exact: "Empty", orderKey: 40, note: "Unmarked thought" }),
				stateOf({ id: FIFTH_ID, exact: "epsilon", orderKey: 5, note: "Fifth thought" }),
			],
		});

		expect(chapter.bodyHtml).toBe(
			`<p>${markOf({ id: FIRST_ID, text: "Alpha", noted: "end" })}${referenceOf({ id: FIRST_ID, number: 2 })} and ${markOf({ id: SECOND_ID, text: "beta" })} then ${markOf({ id: FIFTH_ID, text: "epsilon", noted: "end" })}${referenceOf({ id: FIFTH_ID, number: 1 })}.</p>`,
		);
		expect(chapter.highlightsHtml).toBe(
			[
				"<h2>Highlights</h2>",
				"<blockquote><p>epsilon</p></blockquote>",
				`<p id="endnote-highlight-${FIFTH_ID}"><a role="doc-backlink" href="#noteref-highlight-${FIFTH_ID}">1</a> Fifth thought</p>`,
				"<blockquote><p>Alpha</p></blockquote>",
				`<p id="endnote-highlight-${FIRST_ID}"><a role="doc-backlink" href="#noteref-highlight-${FIRST_ID}">2</a> First thought</p>`,
				"<blockquote><p>beta</p></blockquote>",
				"<blockquote><p>Gone (not found in the current version)</p></blockquote>",
				"<p>Lost thought</p>",
				"<blockquote><p>Empty</p></blockquote>",
				"<p>Unmarked thought</p>",
			].join(""),
		);
	});

	it("puts each nested highlight's reference after its own last segment with its own number", () => {
		const html = `<p>${markOf({ id: FIRST_ID, text: "One ", noted: "segment" })}<mark class="article-highlight article-highlight--has-note" data-highlight-id="${FIRST_ID}">${markOf({ id: SECOND_ID, text: "two", noted: "end" })}</mark>${markOf({ id: FIRST_ID, text: " three", noted: "end" })}</p>`;

		const chapter = noteReferencedChapterXhtml({
			html,
			states: [
				stateOf({ id: FIRST_ID, exact: "One two three", orderKey: 0, note: "Outer" }),
				stateOf({ id: SECOND_ID, exact: "two", orderKey: 4, note: "Inner" }),
			],
		});

		expect(chapter.bodyHtml).toBe(
			`<p>${markOf({ id: FIRST_ID, text: "One ", noted: "segment" })}<mark class="article-highlight article-highlight--has-note" data-highlight-id="${FIRST_ID}">${markOf({ id: SECOND_ID, text: "two", noted: "end" })}${referenceOf({ id: SECOND_ID, number: 2 })}</mark>${markOf({ id: FIRST_ID, text: " three", noted: "end" })}${referenceOf({ id: FIRST_ID, number: 1 })}</p>`,
		);
	});

	it("keeps the references of two highlights that end on the same character in document order", () => {
		const html = `<p>One <mark class="article-highlight article-highlight--has-note article-highlight--note-end" data-highlight-id="${FIRST_ID}">${markOf({ id: SECOND_ID, text: "two", noted: "end" })}</mark> three</p>`;

		const chapter = noteReferencedChapterXhtml({
			html,
			states: [
				stateOf({ id: FIRST_ID, exact: "two", orderKey: 4, note: "First" }),
				stateOf({ id: SECOND_ID, exact: "two", orderKey: 4, note: "Second" }),
			],
		});

		expect(chapter.bodyHtml).toBe(
			`<p>One <mark class="article-highlight article-highlight--has-note article-highlight--note-end" data-highlight-id="${FIRST_ID}">${markOf({ id: SECOND_ID, text: "two", noted: "end" })}${referenceOf({ id: SECOND_ID, number: 2 })}</mark>${referenceOf({ id: FIRST_ID, number: 1 })} three</p>`,
		);
	});

	it("puts the reference of a passage that ends inside a link after the outermost link", () => {
		const html = `<p>See <a href="https://example.com/a"><span><a href="https://example.com/b">${markOf({ id: FIRST_ID, text: "this", noted: "end" })}</a></span></a> now</p>`;

		const chapter = noteReferencedChapterXhtml({
			html,
			states: [stateOf({ id: FIRST_ID, exact: "this", orderKey: 0, note: "Linked" })],
		});

		expect(chapter.bodyHtml).toBe(
			`<p>See <a href="https://example.com/a"><span><a href="https://example.com/b">${markOf({ id: FIRST_ID, text: "this", noted: "end" })}</a></span></a>${referenceOf({ id: FIRST_ID, number: 1 })} now</p>`,
		);
	});

	it("puts the references of two passages that end inside one link after it in document order", () => {
		const html = `<p><a href="https://example.com/a">${markOf({ id: FIRST_ID, text: "this", noted: "end" })} and ${markOf({ id: SECOND_ID, text: "that", noted: "end" })}</a> now</p>`;

		const chapter = noteReferencedChapterXhtml({
			html,
			states: [
				stateOf({ id: FIRST_ID, exact: "this", orderKey: 0, note: "First" }),
				stateOf({ id: SECOND_ID, exact: "that", orderKey: 9, note: "Second" }),
			],
		});

		expect(chapter.bodyHtml).toBe(
			`<p><a href="https://example.com/a">${markOf({ id: FIRST_ID, text: "this", noted: "end" })} and ${markOf({ id: SECOND_ID, text: "that", noted: "end" })}</a>${referenceOf({ id: FIRST_ID, number: 1 })}${referenceOf({ id: SECOND_ID, number: 2 })} now</p>`,
		);
	});

	it("leaves the body as it is and lists no section when there are no highlights", () => {
		expect(noteReferencedChapterXhtml({ html: "<p>Plain</p>", states: [] })).toEqual({
			bodyHtml: "<p>Plain</p>",
			highlightsHtml: "",
		});
	});
});
