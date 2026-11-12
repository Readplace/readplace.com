import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import {
	collectTextChunks,
	describeRange,
	normaliseText,
} from "@packages/domain/article/highlight";
import { JSDOM } from "jsdom";
import { parseHTML } from "linkedom";
import { markHighlights } from "./mark-highlights";
import { servedContentHash } from "./served-content-hash";

const CANONICAL_HASH = "canonical-hash";
const FIRST_ID = HighlightIdSchema.parse(
	"0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e",
);
const SECOND_ID = HighlightIdSchema.parse(
	"1c9a7d2f-3e4b-4c6d-9e0f-1a2b3c4d5e6f",
);

function servedTextOf(html: string): string {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="probe">${html}</div></body></html>`,
	);
	const root = document.querySelector("div#probe");
	assert(root);
	return normaliseText(collectTextChunks<Node>(root)).text;
}

function highlightOn(input: {
	html: string;
	exact: string;
	highlightId: Highlight["highlightId"];
	anchoredContentHash?: string;
}): Highlight {
	const text = servedTextOf(input.html);
	const start = text.indexOf(input.exact);
	assert.ok(start >= 0, `"${input.exact}" must be in the served text`);
	const described = describeRange({
		text,
		start,
		end: start + input.exact.length,
	});
	return {
		highlightId: input.highlightId,
		highlightOf: "https://example.com/article",
		exact: described.exact,
		prefix: described.prefix,
		suffix: described.suffix,
		start: described.start,
		end: described.end,
		anchoredContentHash: input.anchoredContentHash ?? CANONICAL_HASH,
		anchorState: "anchored",
		orderKey: 0,
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
	};
}

function marksOf(html: string): HTMLElement[] {
	const doc = new JSDOM(`<!doctype html><html><body>${html}</body></html>`)
		.window.document;
	return Array.from(doc.querySelectorAll<HTMLElement>("mark"));
}

describe("markHighlights", () => {
	it("marks a passage across an <em> with one id and a data-highlight-id on every piece", () => {
		const html = "<p>Alpha <em>beta</em> gamma</p>";
		const highlight = highlightOn({
			html,
			exact: "pha beta gam",
			highlightId: FIRST_ID,
		});

		const marked = markHighlights({
			html,
			highlights: { rows: [highlight], canonicalContentHash: CANONICAL_HASH },
		});

		const marks = marksOf(marked.html);
		expect(marks.map((mark) => mark.textContent)).toEqual([
			"pha ",
			"beta",
			" gam",
		]);
		expect(marks.map((mark) => mark.getAttribute("data-highlight-id"))).toEqual(
			[FIRST_ID, FIRST_ID, FIRST_ID],
		);
		expect(marks.map((mark) => mark.getAttribute("id"))).toEqual([
			`highlight-${FIRST_ID}`,
			null,
			null,
		]);
		expect(
			marks.every((mark) => mark.getAttribute("class") === "article-highlight"),
		).toBe(true);
		expect(marked.states).toEqual([
			{
				highlight,
				anchor: {
					start: highlight.start,
					end: highlight.end,
					anchorState: "anchored",
				},
			},
		]);
	});

	it("marks two highlights in one paragraph, each with its own id", () => {
		const html = "<p>One two three four</p>";
		const first = highlightOn({ html, exact: "two", highlightId: FIRST_ID });
		const second = highlightOn({ html, exact: "four", highlightId: SECOND_ID });

		const marked = markHighlights({
			html,
			highlights: {
				rows: [second, first],
				canonicalContentHash: CANONICAL_HASH,
			},
		});

		const marks = marksOf(marked.html);
		expect(
			marks.map((mark) => [mark.textContent, mark.getAttribute("id")]),
		).toEqual([
			["two", `highlight-${FIRST_ID}`],
			["four", `highlight-${SECOND_ID}`],
		]);
	});

	it("nests the marks where two highlights overlap, so each keeps every piece", () => {
		const html = "<p>One two three</p>";
		const first = highlightOn({
			html,
			exact: "One two",
			highlightId: FIRST_ID,
		});
		const second = highlightOn({
			html,
			exact: "two three",
			highlightId: SECOND_ID,
		});

		const marked = markHighlights({
			html,
			highlights: {
				rows: [first, second],
				canonicalContentHash: CANONICAL_HASH,
			},
		});

		const pieces = (highlightId: string) =>
			marksOf(marked.html)
				.filter(
					(mark) => mark.getAttribute("data-highlight-id") === highlightId,
				)
				.map((mark) => mark.textContent)
				.join("");
		expect(pieces(FIRST_ID)).toBe("One two");
		expect(pieces(SECOND_ID)).toBe("two three");
	});

	it("gives identical and overlapping ranges each their own first mark, their own text and the passage text kept", () => {
		const html = "<p>Alpha beta gamma delta</p>";
		const THIRD_ID = HighlightIdSchema.parse(
			"2d0b8e3a-4f5c-4d7e-8f1a-2b3c4d5e6f70",
		);
		const first = highlightOn({
			html,
			exact: "beta gamma",
			highlightId: FIRST_ID,
		});
		const identical = highlightOn({
			html,
			exact: "beta gamma",
			highlightId: SECOND_ID,
		});
		const overlapping = highlightOn({
			html,
			exact: "gamma delta",
			highlightId: THIRD_ID,
		});

		const marked = markHighlights({
			html,
			highlights: {
				rows: [first, identical, overlapping],
				canonicalContentHash: CANONICAL_HASH,
			},
		});

		const marks = marksOf(marked.html);
		for (const [highlightId, text] of [
			[FIRST_ID, "beta gamma"],
			[SECOND_ID, "beta gamma"],
			[THIRD_ID, "gamma delta"],
		]) {
			const own = marks.filter(
				(mark) => mark.getAttribute("data-highlight-id") === highlightId,
			);
			expect(own[0].getAttribute("id")).toBe(`highlight-${highlightId}`);
			expect(own.slice(1).map((mark) => mark.getAttribute("id"))).toEqual(
				own.slice(1).map(() => null),
			);
			expect(own.map((mark) => mark.textContent).join("")).toBe(text);
		}
		const doc = new JSDOM(
			`<!doctype html><html><body>${marked.html}</body></html>`,
		).window.document;
		expect(doc.body.textContent).toBe("Alpha beta gamma delta");
	});

	it("marks a passage across two table rows inside the cells only", () => {
		const html =
			"<table><tbody><tr><td>One</td></tr>\n  <tr><td>Two</td></tr></tbody></table>";
		const highlight = highlightOn({
			html,
			exact: "One\nTwo",
			highlightId: FIRST_ID,
		});

		const marked = markHighlights({
			html,
			highlights: { rows: [highlight], canonicalContentHash: CANONICAL_HASH },
		});

		const marks = marksOf(marked.html);
		expect(marks.map((mark) => mark.textContent)).toEqual(["One", "Two"]);
		expect(marks.every((mark) => mark.parentElement?.tagName === "TD")).toBe(
			true,
		);
	});

	it("leaves an orphaned highlight unmarked and reports it in the states", () => {
		const html = "<p>Nothing to see</p>";
		const highlight = {
			...highlightOn({ html, exact: "Nothing", highlightId: FIRST_ID }),
			exact: "absent passage",
		};

		const marked = markHighlights({
			html,
			highlights: { rows: [highlight], canonicalContentHash: CANONICAL_HASH },
		});

		expect(marksOf(marked.html)).toEqual([]);
		expect(marked.states.map((state) => state.anchor.anchorState)).toEqual([
			"orphaned",
		]);
	});

	it("keeps the offsets of a passage after an emoji", () => {
		const html = "<p>Hello 😀 world wide</p>";
		const highlight = highlightOn({
			html,
			exact: "world",
			highlightId: FIRST_ID,
		});

		const marked = markHighlights({
			html,
			highlights: { rows: [highlight], canonicalContentHash: CANONICAL_HASH },
		});

		expect(highlight.start).toBe(9);
		expect(marksOf(marked.html).map((mark) => mark.textContent)).toEqual([
			"world",
		]);
		expect(marked.states[0].anchor).toEqual({
			start: 9,
			end: 14,
			anchorState: "anchored",
		});
	});

	it("strips the class, id and data-highlight-id a publisher's own mark carries", () => {
		const html = `<p><mark class="article-highlight" id="highlight-${SECOND_ID}" data-highlight-id="${SECOND_ID}">theirs</mark></p>`;

		const marked = markHighlights({
			html,
			highlights: { rows: [], canonicalContentHash: undefined },
		});

		expect(marked.html).toBe("<p><mark>theirs</mark></p>");
		expect(marked.states).toEqual([]);
	});

	it("marks every segment of a noted highlight as having a note and only its last as the note's end", () => {
		const html = "<p>Alpha <em>beta</em> gamma</p>";
		const highlight = {
			...highlightOn({ html, exact: "pha beta", highlightId: FIRST_ID }),
			note: "My thought",
		};

		const marked = markHighlights({
			html,
			highlights: { rows: [highlight], canonicalContentHash: CANONICAL_HASH },
		});

		const marks = marksOf(marked.html);
		expect(marks.map((mark) => mark.getAttribute("class"))).toEqual([
			"article-highlight article-highlight--has-note",
			"article-highlight article-highlight--has-note article-highlight--note-end",
		]);
		expect(marks.map((mark) => mark.getAttribute("id"))).toEqual([
			`highlight-${FIRST_ID}`,
			null,
		]);
	});

	it("gives a highlight without a note the plain highlight class only", () => {
		const html = "<p>One two three</p>";
		const highlight = highlightOn({ html, exact: "two", highlightId: FIRST_ID });

		const marked = markHighlights({
			html,
			highlights: { rows: [highlight], canonicalContentHash: CANONICAL_HASH },
		});

		expect(marksOf(marked.html).map((mark) => mark.getAttribute("class"))).toEqual([
			"article-highlight",
		]);
	});

	it("marks a noted outer highlight's segments and leaves an un-noted inner one plain", () => {
		const html = "<p>One two three</p>";
		const outer = {
			...highlightOn({ html, exact: "One two three", highlightId: FIRST_ID }),
			note: "Outer thought",
		};
		const inner = highlightOn({ html, exact: "two", highlightId: SECOND_ID });

		const marked = markHighlights({
			html,
			highlights: {
				rows: [outer, inner],
				canonicalContentHash: CANONICAL_HASH,
			},
		});

		expect(
			marksOf(marked.html).map((mark) => [
				mark.getAttribute("data-highlight-id"),
				mark.getAttribute("class"),
			]),
		).toEqual([
			[FIRST_ID, "article-highlight article-highlight--has-note"],
			[FIRST_ID, "article-highlight article-highlight--has-note"],
			[SECOND_ID, "article-highlight"],
			[
				FIRST_ID,
				"article-highlight article-highlight--has-note article-highlight--note-end",
			],
		]);
	});

	it("marks the note's end on each of two noted highlights that end on the same character", () => {
		const html = "<p>One two three</p>";
		const first = {
			...highlightOn({ html, exact: "two three", highlightId: FIRST_ID }),
			note: "First thought",
		};
		const second = {
			...highlightOn({ html, exact: "three", highlightId: SECOND_ID }),
			note: "Second thought",
		};

		const marked = markHighlights({
			html,
			highlights: {
				rows: [first, second],
				canonicalContentHash: CANONICAL_HASH,
			},
		});

		const lastSegmentClassOf = (highlightId: string) =>
			marksOf(marked.html)
				.filter((mark) => mark.getAttribute("data-highlight-id") === highlightId)
				.at(-1)
				?.getAttribute("class");
		expect([lastSegmentClassOf(FIRST_ID), lastSegmentClassOf(SECOND_ID)]).toEqual([
			"article-highlight article-highlight--has-note article-highlight--note-end",
			"article-highlight article-highlight--has-note article-highlight--note-end",
		]);
		expect(marked.noteEnds).toEqual(new Set([FIRST_ID, SECOND_ID]));
	});

	it("leaves an orphaned noted highlight unmarked and keeps its note in the states", () => {
		const html = "<p>Nothing to see here</p>";
		const orphaned = {
			...highlightOn({ html, exact: "Nothing", highlightId: FIRST_ID }),
			exact: "absent passage",
			note: "Lost thought",
		};
		const anchored = {
			...highlightOn({ html, exact: "see", highlightId: SECOND_ID }),
			note: "Kept thought",
		};

		const marked = markHighlights({
			html,
			highlights: {
				rows: [orphaned, anchored],
				canonicalContentHash: CANONICAL_HASH,
			},
		});

		expect(
			marksOf(marked.html).map((mark) => mark.getAttribute("data-highlight-id")),
		).toEqual([SECOND_ID]);
		expect(marked.noteEnds).toEqual(new Set([SECOND_ID]));
		expect(
			marked.states.map((state) => [
				state.highlight.highlightId,
				state.anchor.anchorState,
				state.highlight.note,
			]),
		).toEqual([
			[FIRST_ID, "orphaned", "Lost thought"],
			[SECOND_ID, "anchored", "Kept thought"],
		]);
	});

	it("moves a noted highlight's note end with the passage when re-anchoring finds it elsewhere", () => {
		const original = "<p>Alpha beta gamma delta</p>";
		const highlight = {
			...highlightOn({
				html: original,
				exact: "beta gamma",
				highlightId: FIRST_ID,
			}),
			note: "My thought",
		};
		const moved = "<p>A new opening paragraph.</p><p>Alpha beta gamma delta</p>";

		const marked = markHighlights({
			html: moved,
			highlights: { rows: [highlight], canonicalContentHash: "new-hash" },
		});

		const doc = new JSDOM(
			`<!doctype html><html><body>${marked.html}</body></html>`,
		).window.document;
		expect(doc.querySelectorAll("p")[1].outerHTML).toBe(
			`<p>Alpha <mark id="highlight-${FIRST_ID}" data-highlight-id="${FIRST_ID}" class="article-highlight article-highlight--has-note article-highlight--note-end">beta gamma</mark> delta</p>`,
		);
	});

	it("uses the served text's own hash as the fast path's hash when the article has no canonical hash", () => {
		const html = "<p>x said a x</p>";
		const highlight = {
			...highlightOn({
				html,
				exact: "x",
				highlightId: FIRST_ID,
				anchoredContentHash: servedContentHash(servedTextOf(html)),
			}),
			start: 9,
			end: 10,
		};

		const marked = markHighlights({
			html,
			highlights: { rows: [highlight], canonicalContentHash: undefined },
		});

		expect(marked.states[0].anchor).toEqual({
			start: 9,
			end: 10,
			anchorState: "anchored",
		});
	});
});
