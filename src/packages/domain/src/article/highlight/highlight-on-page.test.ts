import assert from "node:assert/strict";
import { CandidateIdSchema } from "@packages/article-state-types";
import { highlightOnPage, type PlaceableHighlight, relocateHighlight } from "./highlight-on-page";
import { describeRange, normaliseText } from "./text-anchoring";

const BASIS = CandidateIdSchema.parse("basis-candidate");

function textOf(paragraphs: readonly string[]): string {
	return normaliseText(paragraphs.map((text) => ({ text, blockBoundaryBefore: true }))).text;
}

function rowOn(params: {
	text: string;
	quote: string;
	anchoredContentHash: string;
	anchorState?: PlaceableHighlight["anchorState"];
	basis?: boolean;
	basisQuote?: string;
}): PlaceableHighlight {
	const start = params.text.indexOf(params.quote);
	assert.notEqual(start, -1, "the quote is in the text");
	return {
		...describeRange({ text: params.text, start, end: start + params.quote.length }),
		anchoredContentHash: params.anchoredContentHash,
		anchorState: params.anchorState ?? "anchored",
		...(params.basis === true ? { basisCandidateId: BASIS } : {}),
		...(params.basisQuote === undefined ? {} : { basisQuote: params.basisQuote }),
	};
}

function wordsAt(text: string, range: { start: number; end: number } | undefined): string | undefined {
	return range === undefined ? undefined : text.slice(range.start, range.end);
}

const INTRO = "Intro here.";
const OUTRO = "Outro here.";
const NORTH = "Up north the old bridge was closed for repairs in autumn.";
const SOUTH = "Down south the old bridge carried trains until the flood came.";

describe("highlightOnPage", () => {
	describe("a row with no basis", () => {
		it("is drawn where today's fuzzy pass places it, widened to whole words", () => {
			const before = "Two years on, ridership has passed the forecasts and traffic on the avenue has fallen by a fifth.";
			const after = "Two years on, ridership has passed the projections and traffic on the boulevard has fallen by a fifth.";
			const row = rowOn({
				text: textOf([INTRO, before, OUTRO]),
				quote: "ridership has passed the forecasts and traffic on the avenue",
				anchoredContentHash: "h0",
			});
			const text = textOf([INTRO, after, OUTRO]);

			assert.equal(
				wordsAt(text, highlightOnPage({ text, contentHash: "h1", highlight: row })),
				"ridership has passed the projections and traffic on the boulevard",
			);
		});

		it("is not drawn when today's pass orphans it", () => {
			const row = rowOn({ text: textOf([INTRO, NORTH, OUTRO]), quote: "closed for repairs", anchoredContentHash: "h0" });
			const text = textOf([INTRO, SOUTH, OUTRO]);

			assert.equal(highlightOnPage({ text, contentHash: "h1", highlight: row }), undefined);
		});
	});

	describe("a row with a basis at its own hash", () => {
		const text = textOf([INTRO, NORTH.replace("old bridge", "old iron bridge"), SOUTH, OUTRO]);

		it("is drawn at its stored offsets while they hold its words", () => {
			const row = rowOn({ text, quote: "the old iron bridge", anchoredContentHash: "h1", anchorState: "moved", basis: true, basisQuote: "the old iron bridge" });

			assert.deepEqual(highlightOnPage({ text, contentHash: "h1", highlight: row }), { start: row.start, end: row.end });
		});

		it("is never drawn once it was not found", () => {
			const row = rowOn({ text, quote: "the old iron bridge", anchoredContentHash: "h1", anchorState: "orphaned", basis: true });

			assert.equal(highlightOnPage({ text, contentHash: "h1", highlight: row }), undefined);
		});
	});

	describe("a row with a basis at another hash", () => {
		const before = textOf([INTRO, NORTH.replace("old bridge", "old iron bridge"), SOUTH, OUTRO]);
		const row = rowOn({ text: before, quote: "the old iron bridge", anchoredContentHash: "h1", anchorState: "moved", basis: true, basisQuote: "the old iron bridge" });

		it("is drawn where its words and context occur once", () => {
			const text = textOf([INTRO, NORTH.replace("old bridge", "old iron bridge"), SOUTH, OUTRO, "A closing line."]);

			assert.equal(wordsAt(text, highlightOnPage({ text, contentHash: "h2", highlight: row })), "the old iron bridge");
		});

		it("is not drawn when its passage is gone", () => {
			const text = textOf([INTRO, SOUTH, OUTRO, "A closing line."]);

			assert.equal(highlightOnPage({ text, contentHash: "h2", highlight: row }), undefined);
		});

		it("is not drawn when it has no context to prove the place", () => {
			const text = "the old bridge";
			const bare = rowOn({ text, quote: "the old bridge", anchoredContentHash: "h1", basis: true });
			assert.equal(bare.prefix, "");
			assert.equal(bare.suffix, "");

			assert.equal(highlightOnPage({ text, contentHash: "h2", highlight: bare }), undefined);
		});

		it("is not drawn when its words and context occur twice", () => {
			const text = textOf([INTRO, NORTH.replace("old bridge", "old iron bridge"), INTRO, NORTH.replace("old bridge", "old iron bridge"), OUTRO]);

			assert.equal(highlightOnPage({ text, contentHash: "h2", highlight: row }), undefined);
		});
	});
});

describe("relocateHighlight", () => {
	it("finds the words where they occur once when the stored offsets no longer hold them", () => {
		const text = textOf([INTRO, NORTH, OUTRO]);
		const row = { ...rowOn({ text, quote: "closed for repairs", anchoredContentHash: "h1", basis: true }), start: 0, end: 5 };

		assert.equal(wordsAt(text, relocateHighlight({ text, highlight: row })), "closed for repairs");
	});

	it("uses the context when the words occur more than once", () => {
		const text = textOf([INTRO, NORTH, SOUTH, OUTRO]);
		const row = { ...rowOn({ text, quote: "the old bridge", anchoredContentHash: "h1", basis: true }), start: 0, end: 5 };
		const place = relocateHighlight({ text, highlight: row });

		assert.deepEqual(place, { start: text.indexOf("the old bridge"), end: text.indexOf("the old bridge") + "the old bridge".length });
	});

	it("matches words across a different run of white space", () => {
		const text = textOf([INTRO, NORTH, OUTRO]);
		const row = { ...rowOn({ text, quote: "closed for repairs", anchoredContentHash: "h1", basis: true }), basisQuote: "closed  for\nrepairs" };

		assert.deepEqual(relocateHighlight({ text, highlight: row }), { start: row.start, end: row.end });
	});

	it("reads regular expression characters in the words literally", () => {
		const text = textOf([INTRO, "Prices rose to $5 (or more) in March.", OUTRO]);
		const row = { ...rowOn({ text, quote: "$5 (or more)", anchoredContentHash: "h1", basis: true }), start: 0, end: 3 };

		assert.equal(wordsAt(text, relocateHighlight({ text, highlight: row })), "$5 (or more)");
	});
});
