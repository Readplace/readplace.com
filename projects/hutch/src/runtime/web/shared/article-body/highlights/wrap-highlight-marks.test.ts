import assert from "node:assert/strict";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { JSDOM } from "jsdom";
import { wrapHighlightMarks } from "./wrap-highlight-marks";

function rootOf(html: string): { document: Document; root: Element } {
	const { document } = new JSDOM(`<!doctype html><html><body><div id="root">${html}</div></body></html>`).window;
	const root = document.getElementById("root");
	assert(root, "the fixture renders its root");
	return { document, root };
}

function wrap(input: { html: string; quote: string; note?: string }) {
	const { document, root } = rootOf(input.html);
	const chunks = collectTextChunks<ChildNode>(root);
	const { text, spans } = normaliseText(chunks);
	const start = text.indexOf(input.quote);
	assert.ok(start >= 0, `the fixture contains "${input.quote}"`);
	const noteEnds = wrapHighlightMarks({
		document,
		root,
		chunks,
		spans,
		highlights: [
			{
				highlightId: "local-1",
				note: input.note,
				anchor: { start, end: start + input.quote.length, anchorState: "anchored" },
			},
		],
		idPrefix: "highlight-",
	});
	return { root, noteEnds };
}

describe("wrapHighlightMarks", () => {
	it("marks a range that spans two text nodes, minting the anchor id on its first segment only", () => {
		const { root } = wrap({ html: "<p>One <em>two three</em> four</p>", quote: "One two" });

		const marks = Array.from(root.querySelectorAll("mark"));
		assert.deepEqual(
			marks.map((mark) => ({
				text: mark.textContent,
				id: mark.getAttribute("id"),
				highlightId: mark.getAttribute("data-highlight-id"),
				className: mark.className,
			})),
			[
				{ text: "One ", id: "highlight-local-1", highlightId: "local-1", className: "article-highlight" },
				{ text: "two", id: null, highlightId: "local-1", className: "article-highlight" },
			],
		);
		assert.equal(root.textContent, "One two three four");
	});

	it("marks the last segment of a noted highlight as its note's end", () => {
		const { root, noteEnds } = wrap({
			html: "<p>One <em>two three</em> four</p>",
			quote: "One two",
			note: "Remember this",
		});

		const marks = Array.from(root.querySelectorAll("mark"));
		assert.deepEqual(
			marks.map((mark) => mark.className),
			[
				"article-highlight article-highlight--has-note",
				"article-highlight article-highlight--has-note article-highlight--note-end",
			],
		);
		assert.deepEqual([...noteEnds], ["local-1"]);
	});

	it("leaves an orphaned highlight unmarked", () => {
		const { document, root } = rootOf("<p>Nothing to mark here</p>");
		const chunks = collectTextChunks<ChildNode>(root);
		const { spans } = normaliseText(chunks);

		wrapHighlightMarks({
			document,
			root,
			chunks,
			spans,
			highlights: [{ highlightId: "local-1", anchor: { start: 0, end: 7, anchorState: "orphaned" } }],
			idPrefix: "highlight-",
		});

		assert.equal(root.innerHTML, "<p>Nothing to mark here</p>");
	});
});
