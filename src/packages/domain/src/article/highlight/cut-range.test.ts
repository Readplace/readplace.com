import assert from "node:assert/strict";
import { cutRange } from "./cut-range";

function piecesOf(params: { text: string; maxLength: number }): string[] {
	return cutRange({ text: params.text, range: { start: 0, end: params.text.length }, maxLength: params.maxLength }).map(
		(piece) => params.text.slice(piece.start, piece.end),
	);
}

describe("cutRange", () => {
	it("keeps a range within the cap as one piece", () => {
		assert.deepEqual(cutRange({ text: "abcdef", range: { start: 1, end: 5 }, maxLength: 4 }), [{ start: 1, end: 5 }]);
	});

	it("cuts a long range at paragraph ends into pieces within the cap that join back with no gap or overlap", () => {
		const paragraph = `${"word ".repeat(1499)}end.`;
		const text = Array.from({ length: 3 }, () => paragraph).join("\n");
		assert.equal(text.length > 20_000, true);

		const pieces = cutRange({ text, range: { start: 0, end: text.length }, maxLength: 8191 });

		assert.deepEqual(pieces, [
			{ start: 0, end: paragraph.length + 1 },
			{ start: paragraph.length + 1, end: 2 * (paragraph.length + 1) },
			{ start: 2 * (paragraph.length + 1), end: text.length },
		]);
	});

	it("cuts at the last paragraph end inside the piece", () => {
		assert.deepEqual(piecesOf({ text: "One.\nTwo.\nThree and four", maxLength: 14 }), [
			"One.\nTwo.\n",
			"Three and four",
		]);
	});

	it("cuts at the last sentence end when the piece holds no paragraph end", () => {
		assert.deepEqual(piecesOf({ text: "The fox jumps. The dog sleeps. The cat", maxLength: 34 }), [
			"The fox jumps. The dog sleeps. ",
			"The cat",
		]);
	});

	it("cuts at the last whitespace when the piece holds no sentence end", () => {
		assert.deepEqual(piecesOf({ text: "alpha beta gamma delta", maxLength: 14 }), ["alpha beta ", "gamma delta"]);
	});

	it("cuts a range of whitespace alone at its last whitespace", () => {
		assert.deepEqual(piecesOf({ text: "     ", maxLength: 2 }), ["  ", "  ", " "]);
	});

	it("cuts at the cap when the piece holds no whitespace", () => {
		assert.deepEqual(piecesOf({ text: "abcdefghij", maxLength: 4 }), ["abcd", "efgh", "ij"]);
	});

	it("moves the cut back one unit rather than split a surrogate pair", () => {
		assert.deepEqual(piecesOf({ text: "abc😀def", maxLength: 4 }), ["abc", "😀de", "f"]);
	});
});
