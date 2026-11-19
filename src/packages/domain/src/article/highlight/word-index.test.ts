import assert from "node:assert/strict";
import { aboveSimilarity, createWordIndex } from "./word-index";

describe("createWordIndex", () => {
	it("tokenizes words, single Han and Thai characters, symbols and line breaks", () => {
		const index = createWordIndex();
		const tokens = index.tokenize("Hi 世界!\nก");

		assert.deepEqual(tokens.starts, [0, 3, 4, 5, 6, 7]);
		assert.deepEqual(tokens.ends, [2, 4, 5, 6, 7, 8]);
		assert.deepEqual(index.words("Hi 世界!\nก").length, 4);
		assert.deepEqual(index.tokensOf("a!\nb").length, 3);
	});

	it("matches words that are equal, equal without case, or near-spellings", () => {
		const index = createWordIndex();
		const [colour, color, Colour, house, a, b] = index.words(
			"colour color Colour house a b",
		);

		assert.equal(index.near({ a: colour, b: colour }), true);
		assert.equal(index.near({ a: colour, b: Colour }), true);
		assert.equal(index.near({ a: colour, b: color }), true);
		assert.equal(index.near({ a: color, b: colour }), true);
		assert.equal(index.near({ a: colour, b: house }), false);
		assert.equal(index.near({ a: a, b: b }), false);
		assert.equal(index.isWord(colour), true);
		assert.equal(index.fold(Colour), "colour");
	});

	it("measures nothing shared with an empty side", () => {
		const index = createWordIndex();
		const some = index.words("some words");

		assert.equal(index.dice({ a: [], b: some }), 0);
		assert.equal(index.dice({ a: some, b: [] }), 0);
		assert.equal(index.corr({ a: [], b: some, plain: false }), 0);
		assert.equal(index.corr({ a: some, b: [], plain: false }), 0);
	});

	it("counts a contained sentence as 1 unless plain", () => {
		const index = createWordIndex();
		const short = index.words("the quick fox");
		const long = index.words("the quick brown fox");

		assert.equal(index.corr({ a: short, b: long, plain: false }), 1);
		assert.equal(index.corr({ a: long, b: short, plain: false }), 1);
		assert.ok(index.corr({ a: short, b: long, plain: true }) < 1);
		assert.equal(index.dice({ a: short, b: long }), 6 / 7);
	});

	it("shares over words, or over symbols when the quote has no words", () => {
		const index = createWordIndex();

		assert.equal(
			index.share({ quote: "quick fox", place: "the quick fox" }),
			0.8,
		);
		assert.equal(index.share({ quote: "!!", place: "!!" }), 1);
		assert.equal(
			index.sentenceShare({ was: "quick fox", now: "the quick fox" }),
			1,
		);
		assert.equal(index.sentenceShare({ was: "!?", now: "?!" }), 0.5);
		assert.equal(aboveSimilarity(0.5), false);
	});

	it("ends sentences at line breaks, spaced stops, closing quotes, wide stops and 100 words", () => {
		const index = createWordIndex();
		const sentencesOf = (text: string) => {
			const tokens = index.tokenize(text);
			return index
				.sentences(tokens)
				.map(([low, high]) =>
					text.slice(tokens.starts[low], tokens.ends[high - 1]),
				);
		};

		assert.deepEqual(sentencesOf('One.\n\nTwo is 3.5 "Three." Four。五'), [
			"One.",
			'Two is 3.5 "Three."',
			"Four。",
			"五",
		]);
		assert.deepEqual(sentencesOf("End."), ["End."]);
		const hundred = Array.from({ length: 101 }, () => "w").join(" ");
		assert.deepEqual(
			sentencesOf(hundred).map((sentence) => index.words(sentence).length),
			[100, 1],
		);
	});
});
