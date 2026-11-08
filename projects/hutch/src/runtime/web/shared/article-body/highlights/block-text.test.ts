import assert from "node:assert/strict";
import { collectTextChunks } from "@packages/domain/article/highlight";
import { JSDOM } from "jsdom";
import { blockTextOf } from "./block-text";

function documentOf(body: string): Document {
	return new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window.document;
}

function elementOf(input: { document: Document; selector: string }): Element {
	const element = input.document.querySelector(input.selector);
	assert(element);
	return element;
}

function textNodeOf(input: { document: Document; selector: string }): Node {
	const text = elementOf(input).firstChild;
	assert(text);
	return text;
}

describe("blockTextOf", () => {
	it("walks an Element-typed block once the node type is named", () => {
		const document = documentOf("<p>Plain <em>words</em></p>");
		const paragraph = elementOf({ document, selector: "p" });

		const chunks = collectTextChunks<Node>(paragraph);

		assert.deepEqual(
			chunks.map((chunk) => chunk.text),
			["Plain ", "words"],
		);
	});

	it("joins the text across inline elements in document order", () => {
		const document = documentOf('<p>One <em>two</em> and <a href="/x">three</a>. Four.</p>');

		assert.equal(blockTextOf(elementOf({ document, selector: "p" })).text, "One two and three. Four.");
	});

	it("reads a line break wrapped into the source HTML as the space it renders as", () => {
		const document = documentOf("<p>Starting with the most popular\nones. Then <code>git</code>\r\nconfig.</p>");

		assert.equal(
			blockTextOf(elementOf({ document, selector: "p" })).text,
			"Starting with the most popular ones. Then git config.",
		);
	});

	it("separates the items of a nested list with a line break", () => {
		const document = documentOf('<ul><li id="outer">Parent.<ul><li>First</li><li>Second</li></ul></li></ul>');

		assert.equal(blockTextOf(elementOf({ document, selector: "#outer" })).text, "Parent.\nFirst\nSecond");
	});

	it("starts with no line break when the block opens on a nested block", () => {
		const document = documentOf("<blockquote><p>Quoted</p></blockquote>");

		assert.equal(blockTextOf(elementOf({ document, selector: "blockquote" })).text, "Quoted");
	});

	it("points at the earlier text node at a node boundary", () => {
		const document = documentOf("<p>One <em>two</em></p>");
		const block = blockTextOf(elementOf({ document, selector: "p" }));

		const point = block.pointAt(4);

		assert.equal(point.node, textNodeOf({ document, selector: "p" }));
		assert.equal(point.offset, 4);
	});

	it("points inside the later text node past a node boundary", () => {
		const document = documentOf("<p>One <em>two</em></p>");
		const block = blockTextOf(elementOf({ document, selector: "p" }));

		const point = block.pointAt(5);

		assert.equal(point.node, textNodeOf({ document, selector: "em" }));
		assert.equal(point.offset, 1);
	});

	it("points at the start of a nested block past its line break", () => {
		const document = documentOf('<li id="outer">Parent.<ul><li id="inner">First</li></ul></li>');
		const block = blockTextOf(elementOf({ document, selector: "#outer" }));

		const point = block.pointAt(8);

		assert.equal(point.node, textNodeOf({ document, selector: "#inner" }));
		assert.equal(point.offset, 0);
	});

	it("points at the end of the last text node at the end of the text", () => {
		const document = documentOf("<p>One <em>two</em></p>");
		const block = blockTextOf(elementOf({ document, selector: "p" }));

		const point = block.pointAt(block.text.length);

		assert.equal(point.node, textNodeOf({ document, selector: "em" }));
		assert.equal(point.offset, 3);
	});

	it("refuses to point inside a block that holds no text", () => {
		const document = documentOf("<p></p>");

		assert.throws(() => blockTextOf(elementOf({ document, selector: "p" })).pointAt(0));
	});

	it("reads a caret inside a text node as its offset in the block", () => {
		const document = documentOf("<p>One <em>two</em></p>");
		const block = blockTextOf(elementOf({ document, selector: "p" }));

		assert.equal(
			block.offsetOf({
				node: textNodeOf({ document, selector: "em" }),
				offset: 2,
			}),
			6,
		);
	});

	it("reads an Element caret as the text before the child it indexes", () => {
		const document = documentOf("<p>One <em>two</em> three</p>");
		const paragraph = elementOf({ document, selector: "p" });
		const block = blockTextOf(paragraph);

		assert.equal(block.offsetOf({ node: paragraph, offset: 1 }), 4);
		assert.equal(block.offsetOf({ node: paragraph, offset: 2 }), 7);
	});

	it("reads an Element caret after the last child as the end of the text", () => {
		const document = documentOf("<p>One <em>two</em></p>");
		const paragraph = elementOf({ document, selector: "p" });
		const block = blockTextOf(paragraph);

		assert.equal(block.offsetOf({ node: paragraph, offset: paragraph.childNodes.length }), block.text.length);
	});

	it("reads a caret at a node boundary as the same offset from either side", () => {
		const document = documentOf("<p>One <em>two</em></p>");
		const block = blockTextOf(elementOf({ document, selector: "p" }));

		assert.equal(
			block.offsetOf({
				node: textNodeOf({ document, selector: "p" }),
				offset: 4,
			}),
			4,
		);
		assert.equal(
			block.offsetOf({
				node: textNodeOf({ document, selector: "em" }),
				offset: 0,
			}),
			4,
		);
		assert.equal(
			block.offsetOf({
				node: elementOf({ document, selector: "em" }),
				offset: 0,
			}),
			4,
		);
	});

	it("reads a caret outside the block as no offset", () => {
		const document = documentOf("<p>One</p><p>Other</p>");
		const block = blockTextOf(elementOf({ document, selector: "p" }));

		assert.equal(
			block.offsetOf({
				node: textNodeOf({ document, selector: "p + p" }),
				offset: 1,
			}),
			undefined,
		);
	});

	it("refuses a caret in a block that belongs to no document", () => {
		const document = documentOf("<p>One</p>");
		const block = blockTextOf(document);

		assert.throws(() =>
			block.offsetOf({
				node: textNodeOf({ document, selector: "p" }),
				offset: 1,
			}),
		);
	});
});
