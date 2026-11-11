import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { parseHTML } from "linkedom";
import { collectTextChunks, type TextChunkNode } from "./text-chunks";
import { describeRange, normaliseText } from "./text-anchoring";

interface FakeNode extends TextChunkNode<FakeNode> {}

function fakeText(value: string | null): FakeNode {
	return { nodeType: 3, nodeName: "#text", nodeValue: value, childNodes: [] };
}

function fakeElement(name: string, children: FakeNode[]): FakeNode {
	return { nodeType: 1, nodeName: name, nodeValue: null, childNodes: children };
}

function chunksOf(chunks: { text: string; blockBoundaryBefore: boolean }[]) {
	return chunks.map(({ text, blockBoundaryBefore }) => ({
		text,
		blockBoundaryBefore,
	}));
}

describe("collectTextChunks", () => {
	it("walks a structural node tree with no DOM library", () => {
		const root = fakeElement("div", [
			fakeText("one "),
			fakeElement("em", [fakeText("two")]),
			fakeElement("p", [fakeText("three")]),
			fakeText("four"),
		]);

		assert.deepEqual(chunksOf(collectTextChunks(root)), [
			{ text: "one ", blockBoundaryBefore: false },
			{ text: "two", blockBoundaryBefore: false },
			{ text: "three", blockBoundaryBefore: true },
			{ text: "four", blockBoundaryBefore: true },
		]);
	});

	it("reads an element's children once, as a lazy DOM rebuilds childNodes on every read", () => {
		const reads = new Map<string, number>();
		const countedElement = (name: string, children: FakeNode[]): FakeNode => ({
			nodeType: 1,
			nodeName: name,
			nodeValue: null,
			get childNodes() {
				reads.set(name, (reads.get(name) ?? 0) + 1);
				return children;
			},
		});
		const root = countedElement("div", [
			countedElement("p", [fakeText("one"), fakeText("two")]),
			fakeText("three"),
			countedElement("em", [fakeText("four")]),
		]);

		assert.deepEqual(
			collectTextChunks(root).map((chunk) => chunk.text),
			["one", "two", "three", "four"],
		);
		assert.deepEqual(Object.fromEntries(reads), { div: 1, p: 1, em: 1 });
	});

	it("walks a root of 16,600 sibling paragraphs within the reader's request budget", () => {
		const paragraph = `<p>${"A chapter sentence of a long book. ".repeat(10)}</p>`;
		const { document } = parseHTML(
			`<!doctype html><html><body><div id="content">${paragraph.repeat(16_600)}</div></body></html>`,
		);
		const root = document.getElementById("content");
		assert(root);

		const startedAt = performance.now();
		const chunks = collectTextChunks<Node>(root);
		const elapsedMs = performance.now() - startedAt;

		assert.equal(chunks.length, 16_600);
		assert(elapsedMs < 2_000, `walked in ${elapsedMs} ms`);
	}, 60_000);

	it("keeps the node each chunk was read from", () => {
		const text = fakeText("kept");
		const [chunk] = collectTextChunks(fakeElement("div", [text]));

		assert.equal(chunk.node, text);
	});

	it("gives each chunk the DOM text node its text was read from, in document order", () => {
		const { document } = parseHTML(
			'<!doctype html><html><body><div id="content"><p>one <em>two</em> <a href="/x">three</a><blockquote>four</blockquote>five</p></div></body></html>',
		);
		const root = document.getElementById("content");
		assert(root);

		const chunks = collectTextChunks<Node>(root);

		assert.deepEqual(
			chunks.map((chunk) => chunk.node.nodeValue),
			["one ", "two", " ", "three", "four", "five"],
		);
		for (const chunk of chunks) assert.equal(chunk.node.nodeValue, chunk.text);
	});

	it("reads a text node without a value as empty", () => {
		assert.deepEqual(
			chunksOf(collectTextChunks(fakeElement("div", [fakeText(null)]))),
			[{ text: "", blockBoundaryBefore: false }],
		);
	});

	it("skips comments, scripts and styles", () => {
		const root = fakeElement("div", [
			{ nodeType: 8, nodeName: "#comment", nodeValue: "note", childNodes: [] },
			fakeElement("script", [fakeText("run()")]),
			fakeElement("STYLE", [fakeText("p{}")]),
			fakeText("body"),
		]);

		assert.deepEqual(chunksOf(collectTextChunks(root)), [
			{ text: "body", blockBoundaryBefore: false },
		]);
	});

	it("treats a line break as a block boundary", () => {
		const root = fakeElement("p", [
			fakeText("line one"),
			fakeElement("br", []),
			fakeText("line two"),
		]);

		assert.deepEqual(chunksOf(collectTextChunks(root)), [
			{ text: "line one", blockBoundaryBefore: false },
			{ text: "line two", blockBoundaryBefore: true },
		]);
	});
});

const PARITY_FIXTURES: { name: string; html: string; quote: string }[] = [
	{
		name: "a table",
		html: "<table>\n<thead>\n<tr><th>Name</th><th>Score</th></tr>\n</thead>\n<tr><td>Ada</td><td>10</td></tr>\n<tr><td>Grace <em>Hopper</em></td><td>12</td></tr>\n</table><p>After the table</p>",
		quote: "Grace Hopper",
	},
	{
		name: "a list",
		html: "<p>Before</p>\n<ul>\n  <li>First item</li>\n  <li>Second <a href='/x'>linked</a> item</li>\n</ul>\n<p>After</p>",
		quote: "linked item",
	},
	{
		name: "a block inside a paragraph",
		html: "<p>Intro text <div>a block inside</div> trailing words</p><p>Next “quoted” paragraph</p>",
		quote: "a block inside",
	},
];

describe("text chunk parity between linkedom and JSDOM", () => {
	it.each(PARITY_FIXTURES)("normalises $name to the same text and offsets", ({
		html,
		quote,
	}) => {
		const wrapped = `<!doctype html><html><body><div id="content">${html}</div></body></html>`;
		const linkedomRoot = parseHTML(wrapped).document.getElementById("content");
		const jsdomRoot = new JSDOM(wrapped).window.document.getElementById(
			"content",
		);
		assert(linkedomRoot);
		assert(jsdomRoot);

		const fromLinkedom = normaliseText(collectTextChunks<Node>(linkedomRoot));
		const fromJsdom = normaliseText(collectTextChunks<Node>(jsdomRoot));

		assert.equal(fromLinkedom.text, fromJsdom.text);
		const start = fromJsdom.text.indexOf(quote);
		assert.notEqual(start, -1);
		assert.equal(fromLinkedom.text.indexOf(quote), start);
		assert.deepEqual(
			describeRange({
				text: fromLinkedom.text,
				start,
				end: start + quote.length,
			}),
			describeRange({ text: fromJsdom.text, start, end: start + quote.length }),
		);
	});
});
