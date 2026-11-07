import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import {
	collectTextChunks,
	describeRange,
	normaliseText,
} from "@packages/domain/article/highlight";
import { articleBody } from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import { parseHTML } from "linkedom";
import { prepareReaderContent } from "./reader-content";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "./section-pages";

const TEST_READER_SECTION = {
	requested: undefined,
	readerPath: "/queue/a/view",
	thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES,
};
const TEST_READER_URL = "https://example.com/post";
const APP_ORIGIN = "https://readplace.com";
const CANONICAL_HASH = "canonical-hash";
const READER_ID = HighlightIdSchema.parse(
	"0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e",
);
const PUBLISHER_ID = "1c9a7d2f-3e4b-4c6d-9e0f-1a2b3c4d5e6f";

function browserTextOf(html: string): string {
	const doc = new JSDOM(
		`<!doctype html><html><body><div id="probe">${html}</div></body></html>`,
	).window.document;
	const root = doc.querySelector("div#probe");
	assert(root);
	return normaliseText(collectTextChunks<Node>(root)).text;
}

function prepare(input: {
	content: string;
	highlights?: readonly Highlight[];
}) {
	return prepareReaderContent({
		content: articleBody(input.content),
		appOrigin: APP_ORIGIN,
		url: TEST_READER_URL,
		section: TEST_READER_SECTION,
		highlights:
			input.highlights === undefined
				? undefined
				: { rows: input.highlights, canonicalContentHash: CANONICAL_HASH },
	});
}

function highlightOn(input: { text: string; exact: string }): Highlight {
	const start = input.text.indexOf(input.exact);
	assert.ok(start >= 0, `"${input.exact}" must be in the served text`);
	const described = describeRange({
		text: input.text,
		start,
		end: start + input.exact.length,
	});
	return {
		...described,
		highlightId: READER_ID,
		highlightOf: TEST_READER_URL,
		anchoredContentHash: CANONICAL_HASH,
		anchorState: "anchored",
		orderKey: 0,
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
	};
}

function marksOf(html: string): {
	text: string | null;
	id: string | null;
	highlightId: string | null;
	className: string | null;
}[] {
	const doc = new JSDOM(`<!doctype html><html><body>${html}</body></html>`)
		.window.document;
	return Array.from(doc.querySelectorAll("mark"), (mark) => ({
		text: mark.textContent,
		id: mark.getAttribute("id"),
		highlightId: mark.getAttribute("data-highlight-id"),
		className: mark.getAttribute("class"),
	}));
}

describe("prepareReaderContent highlights", () => {
	it("gives a publisher's mark no attributes when there are no highlights", () => {
		const prepared = prepare({
			content: '<p>Some <mark class="pub" title="t">marked</mark> text</p>',
		});

		expect(marksOf(prepared.html)).toEqual([
			{ text: "marked", id: null, highlightId: null, className: null },
		]);
		expect(prepared.states).toEqual([]);
	});

	it("keeps only the reader's ids when a publisher's mark is shaped like a minted one", () => {
		const content = `<p>Lead <mark class="article-highlight" id="highlight-${PUBLISHER_ID}" data-highlight-id="${PUBLISHER_ID}">theirs</mark> and ours here</p>`;
		const highlight = highlightOn({
			text: browserTextOf(prepare({ content }).html),
			exact: "ours",
		});

		const prepared = prepare({ content, highlights: [highlight] });

		expect(marksOf(prepared.html)).toEqual([
			{ text: "theirs", id: null, highlightId: null, className: null },
			{
				text: "ours",
				id: `highlight-${READER_ID}`,
				highlightId: READER_ID,
				className: "article-highlight",
			},
		]);
		expect(prepared.states.map((state) => state.anchor.anchorState)).toEqual([
			"anchored",
		]);
	});

	it("keeps an encoded javascript: href dead after marking", () => {
		const content =
			'<p><a href="&#106;avascript:alert(1)">bad link</a> then words</p>';
		const highlight = highlightOn({
			text: browserTextOf(prepare({ content }).html),
			exact: "bad link then",
		});

		const prepared = prepare({ content, highlights: [highlight] });

		expect(prepared.html).not.toMatch(/javascript/i);
		expect(
			marksOf(prepared.html)
				.map((mark) => mark.text)
				.join(""),
		).toBe("bad link then");
	});

	it.each([
		[
			"a table",
			"<table><tbody><tr><th>Name</th><td>Ada</td></tr>\n<tr><th>Role</th><td>Engineer</td></tr></tbody></table>",
			"Ada\nRole",
		],
		[
			"a list",
			"<ul>\n<li>First item</li>\n<li>Second <em>item</em></li>\n</ul>",
			"item\nSecond item",
		],
		[
			"a block inside a paragraph",
			"<p>Before<div>inside block</div>after</p>",
			"inside block",
		],
	])("serves the text it anchored against, in %s", (_name, content, exact) => {
		const servedText = browserTextOf(prepare({ content }).html);
		const highlight = highlightOn({ text: servedText, exact });

		const prepared = prepare({ content, highlights: [highlight] });

		expect(browserTextOf(prepared.html)).toBe(servedText);
		expect(prepared.states.map((state) => state.anchor)).toEqual([
			{ start: highlight.start, end: highlight.end, anchorState: "anchored" },
		]);
		expect(
			marksOf(prepared.html)
				.map((mark) => mark.text)
				.join(""),
		).toBe(exact.replace("\n", ""));
	});
});

function pageTextOf(html: string): string {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="probe">${html}</div></body></html>`,
	);
	const root = document.querySelector("div#probe");
	assert(root);
	return normaliseText(collectTextChunks<Node>(root)).text;
}

describe("prepareReaderContent text", () => {
	it("serves each section page's text as a slice of the whole article's text, in page order", () => {
		const content = articleBody(
			[
				`<h2>Chapter 1</h2><p>${"word ".repeat(150)}</p>`,
				"<h2>Chapter 2</h2><p>The second chapter opens here.</p>",
				"<h2>Chapter 3</h2><p>The third chapter closes the book.</p>",
			].join(""),
		);
		const pages = [1, 2, 3].map((requested) =>
			prepareReaderContent({
				content,
				appOrigin: APP_ORIGIN,
				url: TEST_READER_URL,
				section: { ...TEST_READER_SECTION, requested, thresholdBytes: 600 },
			}),
		);

		let previous = -1;
		for (const page of pages) {
			assert.equal(page.kind, "paged");
			const pageText = pageTextOf(page.html);
			const offset = page.text.indexOf(pageText);
			expect(offset).toBeGreaterThan(previous);
			expect(page.text.slice(offset, offset + pageText.length)).toBe(pageText);
			previous = offset;
		}
	});

	it("serves the whole article's text as the page's text when the article is not paged", () => {
		const prepared = prepare({
			content: "<h2>One</h2><p>First part.</p><h2>Two</h2><p>Second part.</p>",
		});

		expect(prepared.kind).toBe("whole");
		expect(browserTextOf(prepared.html)).toBe(prepared.text);
	});
});
