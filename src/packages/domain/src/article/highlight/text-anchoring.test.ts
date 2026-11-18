import assert from "node:assert/strict";
import {
	HIGHLIGHT_CONTEXT_LENGTH,
	HIGHLIGHT_MAX_EXACT_LENGTH,
	HIGHLIGHT_MAX_SELECTION_LENGTH,
	anchorHighlight,
	describeRange,
	mergeRanges,
	normaliseText,
} from "./text-anchoring";

const chunk = (text: string, blockBoundaryBefore = false) => ({
	text,
	blockBoundaryBefore,
});

describe("named limits", () => {
	it("keeps 32 code units of context and caps a quote at 8191", () => {
		assert.equal(HIGHLIGHT_CONTEXT_LENGTH, 32);
		assert.equal(HIGHLIGHT_MAX_EXACT_LENGTH, 8191);
	});

	it("bounds one selection at 65536 code units", () => {
		assert.equal(HIGHLIGHT_MAX_SELECTION_LENGTH, 65536);
	});
});

describe("normaliseText", () => {
	it("folds curly quotes, apostrophes and dashes to ASCII", () => {
		const { text } = normaliseText([
			chunk("“It’s ‘fine’” — she said – twice−"),
		]);

		assert.equal(text, "\"It's 'fine'\" - she said - twice-");
	});

	it("drops soft hyphens and zero-width characters", () => {
		const { text } = normaliseText([chunk("hy­phen​ated﻿ word")]);

		assert.equal(text, "hyphenated word");
	});

	it("composes to NFC", () => {
		const { text } = normaliseText([chunk("café open")]);

		assert.equal(text, "café open");
	});

	it("keeps a leading combining mark", () => {
		assert.equal(normaliseText([chunk("́a")]).text, "́a");
	});

	it("collapses whitespace runs and trims both ends", () => {
		const { text } = normaliseText([chunk("  one \t  two\n\nthree  ")]);

		assert.equal(text, "one two three");
	});

	it("collapses whitespace across chunks into one space", () => {
		assert.equal(
			normaliseText([chunk("one "), chunk(" "), chunk(" two")]).text,
			"one two",
		);
	});

	it("inserts one newline at a block boundary in place of surrounding whitespace", () => {
		const { text } = normaliseText([
			chunk("first "),
			chunk("\n  ", true),
			chunk("second", true),
			chunk("third", true),
		]);

		assert.equal(text, "first\nsecond\nthird");
	});

	it("does not start with a newline when the first chunk opens a block", () => {
		assert.equal(normaliseText([chunk("first", true)]).text, "first");
	});

	it("maps every normalised character back to its raw position", () => {
		const { text, spans } = normaliseText([
			chunk("ab  "),
			chunk("c", true),
			chunk("d—e"),
		]);

		assert.equal(text, "ab\ncd-e");
		assert.deepEqual(spans, [
			{ chunk: 0, start: 0, end: 1 },
			{ chunk: 0, start: 1, end: 2 },
			{ chunk: 1, start: 0, end: 0 },
			{ chunk: 1, start: 0, end: 1 },
			{ chunk: 2, start: 0, end: 1 },
			{ chunk: 2, start: 1, end: 2 },
			{ chunk: 2, start: 2, end: 3 },
		]);
	});

	it("maps a collapsed space to the first raw whitespace of its run", () => {
		const { text, spans } = normaliseText([chunk("a \n b")]);

		assert.equal(text, "a b");
		assert.deepEqual(spans[1], { chunk: 0, start: 1, end: 2 });
	});

	it("keeps UTF-16 offsets after an emoji", () => {
		const { text, spans } = normaliseText([chunk("\u{1F600} smile here")]);

		assert.equal(text, "\u{1F600} smile here");
		assert.equal(text.indexOf("smile"), 3);
		assert.deepEqual(spans.slice(0, 4), [
			{ chunk: 0, start: 0, end: 2 },
			{ chunk: 0, start: 0, end: 2 },
			{ chunk: 0, start: 2, end: 3 },
			{ chunk: 0, start: 3, end: 4 },
		]);
	});

	it("produces one span per code unit", () => {
		const { text, spans } = normaliseText([chunk("café \u{1F600}")]);

		assert.equal(spans.length, text.length);
		assert.deepEqual(spans[3], { chunk: 0, start: 3, end: 5 });
	});
});

describe("describeRange", () => {
	const text =
		"The quick brown fox jumps over the lazy dog and keeps running far away from the farmer who owns it.";

	it("reads the exact passage and its offsets", () => {
		const start = text.indexOf("lazy dog");
		const described = describeRange({
			text,
			start,
			end: start + "lazy dog".length,
		});

		assert.equal(described.exact, "lazy dog");
		assert.equal(described.start, start);
		assert.equal(described.end, start + 8);
	});

	it("cuts the 32-character prefix and suffix back to a word boundary", () => {
		const start = text.indexOf("and keeps");
		const described = describeRange({
			text,
			start,
			end: start + "and keeps".length,
		});

		assert.equal(described.prefix, "fox jumps over the lazy dog ");
		assert.equal(described.suffix, " running far away from the");
		assert.ok(described.prefix.length <= 32);
		assert.ok(described.suffix.length <= 32);
		assert.equal(
			text.slice(start - described.prefix.length, start),
			described.prefix,
		);
		assert.equal(
			text.slice(described.end, described.end + described.suffix.length),
			described.suffix,
		);
	});

	it("keeps the whole context when the text ends within 32 characters", () => {
		const described = describeRange({
			text: "short before PASSAGE short after",
			start: 13,
			end: 20,
		});

		assert.equal(described.prefix, "short before ");
		assert.equal(described.suffix, " short after");
	});

	it("keeps a full window that already starts and ends at a word boundary", () => {
		const before = "x ";
		const window = "a".repeat(31);
		const passageText = `${before}${window} PASSAGE ${window} tail`;
		const start = passageText.indexOf("PASSAGE");
		const described = describeRange({
			text: passageText,
			start,
			end: start + 7,
		});

		assert.equal(described.prefix, `${window} `);
		assert.equal(described.suffix, ` ${window}`);
	});

	it("drops context that is one unbroken word longer than 32 characters", () => {
		const word = "w".repeat(40);
		const passageText = `${word}PASSAGE${word}`;
		const described = describeRange({ text: passageText, start: 40, end: 47 });

		assert.equal(described.prefix, "");
		assert.equal(described.suffix, "");
	});

	it("cuts at a block boundary newline", () => {
		const passageText = `${"p".repeat(40)} head\nPASSAGE\ntail ${"s".repeat(40)}`;
		const start = passageText.indexOf("PASSAGE");
		const described = describeRange({
			text: passageText,
			start,
			end: start + 7,
		});

		assert.equal(described.prefix, "head\n");
		assert.equal(described.suffix, "\ntail");
	});

	it("keeps offsets after an emoji", () => {
		const { text: emojiText } = normaliseText([chunk("\u{1F600} the passage")]);
		const start = emojiText.indexOf("passage");
		const described = describeRange({ text: emojiText, start, end: start + 7 });

		assert.equal(described.start, 7);
		assert.equal(described.exact, "passage");
		assert.equal(described.prefix, "\u{1F600} the ");
	});
});

describe("anchorHighlight", () => {
	const text =
		"Alpha beta gamma. The repeated line. Delta. The repeated line. Epsilon.";
	const firstRepeat = text.indexOf("The repeated line");
	const secondRepeat = text.indexOf("The repeated line", firstRepeat + 1);

	function stored(
		overrides: Partial<Parameters<typeof anchorHighlight>[0]["highlight"]> = {},
	) {
		const described = describeRange({
			text,
			start: secondRepeat,
			end: secondRepeat + 17,
		});
		return { ...described, anchoredContentHash: "hash-a", ...overrides };
	}

	it("uses the stored offsets on the hash fast path", () => {
		assert.deepEqual(
			anchorHighlight({ text, contentHash: "hash-a", highlight: stored() }),
			{
				start: secondRepeat,
				end: secondRepeat + 17,
				anchorState: "anchored",
			},
		);
	});

	it("falls back to the exact pass when the text at the offsets is not the quote", () => {
		const shifted = `Intro. ${text}`;
		const anchor = anchorHighlight({
			text: shifted,
			contentHash: "hash-a",
			highlight: stored(),
		});

		assert.deepEqual(anchor, {
			start: secondRepeat + 7,
			end: secondRepeat + 24,
			anchorState: "moved",
		});
	});

	it("takes a single occurrence under another hash", () => {
		const highlight = {
			...describeRange({ text, start: 0, end: 5 }),
			anchoredContentHash: "hash-a",
		};

		assert.deepEqual(
			anchorHighlight({ text, contentHash: "hash-b", highlight }),
			{
				start: 0,
				end: 5,
				anchorState: "anchored",
			},
		);
	});

	it("picks the duplicate whose context matches", () => {
		const anchor = anchorHighlight({
			text,
			contentHash: "hash-b",
			highlight: stored({ start: firstRepeat, end: firstRepeat + 17 }),
		});

		assert.deepEqual(anchor, {
			start: secondRepeat,
			end: secondRepeat + 17,
			anchorState: "moved",
		});
	});

	it("picks the nearest start when duplicates share their context", () => {
		const repeated = "same text here. same text here. same text here.";
		const anchor = anchorHighlight({
			text: repeated,
			contentHash: "hash-b",
			highlight: {
				exact: "same text",
				prefix: "",
				suffix: "",
				start: 30,
				end: 39,
				anchoredContentHash: "hash-a",
			},
		});

		assert.deepEqual(anchor, { start: 32, end: 41, anchorState: "moved" });
	});

	it("orphans a quote that is no longer in the text and keeps its offsets", () => {
		const anchor = anchorHighlight({
			text: "Entirely different words.",
			contentHash: "hash-b",
			highlight: stored(),
		});

		assert.deepEqual(anchor, {
			start: secondRepeat,
			end: secondRepeat + 17,
			anchorState: "orphaned",
		});
	});

	it("anchors after an emoji on the right text", () => {
		const { text: emojiText } = normaliseText([
			chunk("\u{1F600}\u{1F600} the passage"),
		]);
		const highlight = {
			exact: "passage",
			prefix: "the ",
			suffix: "",
			start: 0,
			end: 7,
			anchoredContentHash: "old",
		};
		const anchor = anchorHighlight({
			text: emojiText,
			contentHash: "new",
			highlight,
		});

		assert.equal(emojiText.slice(anchor.start, anchor.end), "passage");
		assert.equal(anchor.start, 9);
	});
});

describe("mergeRanges", () => {
	const anyNotes = () => true;

	it("merges an overlapping range into the span of both", () => {
		const existing = [{ id: "a", start: 5, end: 15 }];

		assert.deepEqual(
			mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 100, canMerge: anyNotes }),
			{ merged: existing, parts: [{ start: 5, end: 20 }], covering: [] },
		);
	});

	it("merges a range that only touches", () => {
		const existing = [
			{ id: "before", start: 0, end: 10 },
			{ id: "after", start: 20, end: 25 },
		];

		assert.deepEqual(
			mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 100, canMerge: anyNotes }),
			{ merged: existing, parts: [{ start: 0, end: 25 }], covering: [] },
		);
	});

	it("leaves disjoint ranges alone", () => {
		const existing = [{ id: "far", start: 30, end: 40 }];

		assert.deepEqual(
			mergeRanges({ range: { start: 0, end: 10 }, existing, maxLength: 100, canMerge: anyNotes }),
			{ merged: [], parts: [{ start: 0, end: 10 }], covering: [] },
		);
	});

	it("merges a range reached only through another merged range", () => {
		const existing = [
			{ id: "chained", start: 24, end: 30 },
			{ id: "overlapping", start: 15, end: 25 },
			{ id: "far", start: 50, end: 60 },
		];

		assert.deepEqual(
			mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 100, canMerge: anyNotes }),
			{ merged: [existing[1], existing[0]], parts: [{ start: 10, end: 30 }], covering: [] },
		);
	});

	it("leaves a touching neighbour alone and keeps its text out of the range when the merge would pass the length cap", () => {
		const existing = [{ id: "before", start: 0, end: 15 }];

		assert.deepEqual(
			mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 19, canMerge: anyNotes }),
			{ merged: [], parts: [{ start: 15, end: 20 }], covering: existing },
		);
	});

	it("merges up to exactly the length cap", () => {
		const existing = [{ id: "before", start: 0, end: 15 }];

		assert.deepEqual(
			mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 20, canMerge: anyNotes }),
			{ merged: existing, parts: [{ start: 0, end: 20 }], covering: [] },
		);
	});

	it("leaves a neighbour alone when its notes cannot be joined", () => {
		const existing = [{ id: "noted", start: 18, end: 30 }];

		assert.deepEqual(
			mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 100, canMerge: () => false }),
			{ merged: [], parts: [{ start: 10, end: 18 }], covering: existing },
		);
	});

	it("passes every row merged so far, and the candidate, to the note check", () => {
		const existing = [
			{ id: "first", start: 5, end: 12 },
			{ id: "second", start: 18, end: 25 },
		];
		const asked: string[][] = [];

		mergeRanges({
			range: { start: 10, end: 20 },
			existing,
			maxLength: 100,
			canMerge: (rows) => {
				asked.push(rows.map((row) => row.id));
				return true;
			},
		});

		assert.deepEqual(asked, [["first"], ["first", "second"]]);
	});

	it("returns the existing highlight and no remainder for a selection lying wholly inside it", () => {
		const existing = [{ id: "around", start: 0, end: 30 }];

		assert.deepEqual(
			mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 100, canMerge: anyNotes }),
			{ merged: [], parts: [], covering: existing },
		);
	});

	it("splits a selection around a neighbour inside it that it cannot merge", () => {
		const existing = [{ id: "inside", start: 10, end: 20 }];

		assert.deepEqual(
			mergeRanges({ range: { start: 0, end: 30 }, existing, maxLength: 25, canMerge: anyNotes }),
			{
				merged: [],
				parts: [
					{ start: 0, end: 10 },
					{ start: 20, end: 30 },
				],
				covering: existing,
			},
		);
	});

	it("returns no remainder for a selection covered by neighbours it cannot merge", () => {
		const existing = [
			{ id: "right", start: 10, end: 25 },
			{ id: "left", start: 0, end: 10 },
		];

		assert.deepEqual(
			mergeRanges({ range: { start: 5, end: 20 }, existing, maxLength: 12, canMerge: anyNotes }),
			{ merged: [], parts: [], covering: [existing[1], existing[0]] },
		);
	});

	it("merges the neighbour nearer the selection's start first when only one fits", () => {
		const before = { id: "before", start: 0, end: 10 };
		const after = { id: "after", start: 20, end: 32 };

		for (const existing of [
			[before, after],
			[after, before],
		]) {
			assert.deepEqual(
				mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 25, canMerge: anyNotes }),
				{ merged: [before], parts: [{ start: 0, end: 20 }], covering: [] },
			);
		}
	});

	it("merges neighbours equally near the selection's start by their start, then by their end, whatever their order", () => {
		const earlierStart = { id: "earlier-start", start: 0, end: 10 };
		const earlierEnd = { id: "earlier-end", start: 5, end: 10 };
		const laterEnd = { id: "later-end", start: 5, end: 12 };

		for (const existing of [
			[laterEnd, earlierEnd, earlierStart],
			[earlierStart, earlierEnd, laterEnd],
		]) {
			assert.deepEqual(
				mergeRanges({ range: { start: 10, end: 20 }, existing, maxLength: 100, canMerge: anyNotes }).merged,
				[earlierStart, earlierEnd, laterEnd],
			);
		}
	});
});
