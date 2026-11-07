import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { caretAtPoint } from "./caret-at-point";

function textNode(): Node {
	const paragraph = new JSDOM("<p>The fox jumps.</p>").window.document.querySelector("p");
	assert(paragraph?.firstChild, "the fixture paragraph holds text");
	return paragraph.firstChild;
}

describe("caretAtPoint", () => {
	it("uses caretPositionFromPoint when the document has it", () => {
		const node = textNode();
		const calls: Array<[number, number]> = [];
		const caret = caretAtPoint({
			document: {
				caretPositionFromPoint: (x, y) => {
					calls.push([x, y]);
					return { offsetNode: node, offset: 4 };
				},
				caretRangeFromPoint: () => {
					throw new Error("caretRangeFromPoint must not be called");
				},
			},
			x: 12,
			y: 34,
		});

		expect(caret).toEqual({ node, offset: 4 });
		expect(calls).toEqual([[12, 34]]);
	});

	it("falls back to caretRangeFromPoint when caretPositionFromPoint is absent", () => {
		const node = textNode();
		const caret = caretAtPoint({
			document: {
				caretRangeFromPoint: () => ({ startContainer: node, startOffset: 7 }),
			},
			x: 1,
			y: 2,
		});

		expect(caret).toEqual({ node, offset: 7 });
	});

	it("returns undefined when caretPositionFromPoint answers null", () => {
		const caret = caretAtPoint({
			document: {
				caretPositionFromPoint: () => null,
				caretRangeFromPoint: () => null,
			},
			x: 1,
			y: 2,
		});

		expect(caret).toBeUndefined();
	});

	it("returns undefined when caretRangeFromPoint answers null", () => {
		const caret = caretAtPoint({
			document: { caretRangeFromPoint: () => null },
			x: 1,
			y: 2,
		});

		expect(caret).toBeUndefined();
	});
});
