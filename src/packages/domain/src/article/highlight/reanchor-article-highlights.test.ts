import assert from "node:assert/strict";
import { CandidateIdSchema } from "@packages/article-state-types";
import {
	type ReanchorableHighlight,
	type ReanchorCounts,
	reanchorArticleHighlights,
} from "./reanchor-article-highlights";
import { describeRange } from "./text-anchoring";

const OLD_CANDIDATE = CandidateIdSchema.parse("candidate-old");
const NEW_CANDIDATE = CandidateIdSchema.parse("candidate-new");

interface Row extends ReanchorableHighlight {
	highlightId: string;
}

function rowOn(params: {
	highlightId: string;
	text: string;
	passage: string;
	occurrence?: "first" | "last";
}): Row {
	const start =
		params.occurrence === "last"
			? params.text.lastIndexOf(params.passage)
			: params.text.indexOf(params.passage);
	assert.ok(start >= 0, `"${params.passage}" must be in the text`);
	return {
		highlightId: params.highlightId,
		...describeRange({
			text: params.text,
			start,
			end: start + params.passage.length,
		}),
		anchoredContentHash: "old-hash",
		anchoredCandidateId: OLD_CANDIDATE,
		anchorState: "anchored",
		orderKey: start,
		anchorRevision: 3,
	};
}

function countsOf(states: {
	anchored: number;
	moved: number;
	orphaned: number;
}): ReanchorCounts {
	return {
		...states,
		diffed: 0,
		edited: 0,
		gone: 0,
		notPlaced: 0,
		placedByFallback: 0,
		placedElsewhere: 0,
		basisGranted: 0,
		basisMissing: 0,
	};
}

const OLD_TEXT =
	"First paragraph stays put.\nSecond paragraph will be edited away.\nThird paragraph moves down.";

describe("reanchorArticleHighlights", () => {
	it("writes nothing for rows already on the hash and candidate", () => {
		const row = rowOn({
			highlightId: "a",
			text: OLD_TEXT,
			passage: "stays put",
		});

		assert.deepEqual(
			reanchorArticleHighlights({
				text: OLD_TEXT,
				contentHash: "old-hash",
				candidateId: OLD_CANDIDATE,
				highlights: [row],
				anchorTexts: new Map(),
			}),
			{ writes: [], counts: countsOf({ anchored: 0, moved: 0, orphaned: 0 }) },
		);
	});

	it("re-anchors rows on the same hash when the candidate changed", () => {
		const row = rowOn({
			highlightId: "a",
			text: OLD_TEXT,
			passage: "stays put",
		});

		const result = reanchorArticleHighlights({
			text: OLD_TEXT,
			contentHash: "old-hash",
			candidateId: NEW_CANDIDATE,
			highlights: [row],
			anchorTexts: new Map(),
		});

		assert.deepEqual(result.writes, [
			{
				highlight: row,
				expectedRevision: 3,
				anchor: {
					start: row.start,
					end: row.end,
					anchorState: "anchored",
					anchoredContentHash: "old-hash",
					anchoredCandidateId: NEW_CANDIDATE,
					orderKey: row.start,
				},
			},
		]);
		assert.deepEqual(
			result.counts,
			countsOf({ anchored: 1, moved: 0, orphaned: 0 }),
		);
	});

	it("keeps an orphan's offsets and orderKey, moves a shifted row's orderKey, and counts each state", () => {
		const stays = rowOn({
			highlightId: "stays",
			text: OLD_TEXT,
			passage: "First paragraph stays put.",
		});
		const editedAway = rowOn({
			highlightId: "edited-away",
			text: OLD_TEXT,
			passage: "Second paragraph will be edited away.",
		});
		const moves = rowOn({
			highlightId: "moves",
			text: OLD_TEXT,
			passage: "Third paragraph moves down.",
		});
		const newText =
			"First paragraph stays put.\nA brand new paragraph is inserted here.\nThird paragraph moves down.";

		const result = reanchorArticleHighlights({
			text: newText,
			contentHash: "new-hash",
			candidateId: NEW_CANDIDATE,
			highlights: [stays, editedAway, moves],
			anchorTexts: new Map(),
		});

		const movedStart = newText.indexOf("Third paragraph");
		assert.deepEqual(
			result.writes.map((write) => [write.highlight.highlightId, write.anchor]),
			[
				[
					"stays",
					{
						start: 0,
						end: 26,
						anchorState: "anchored",
						anchoredContentHash: "new-hash",
						anchoredCandidateId: NEW_CANDIDATE,
						orderKey: 0,
					},
				],
				[
					"edited-away",
					{
						start: editedAway.start,
						end: editedAway.end,
						anchorState: "orphaned",
						anchoredContentHash: "new-hash",
						anchoredCandidateId: NEW_CANDIDATE,
						orderKey: editedAway.orderKey,
					},
				],
				[
					"moves",
					{
						start: movedStart,
						end: movedStart + 27,
						anchorState: "moved",
						anchoredContentHash: "new-hash",
						anchoredCandidateId: NEW_CANDIDATE,
						orderKey: movedStart,
					},
				],
			],
		);
		assert.deepEqual(
			result.counts,
			countsOf({ anchored: 1, moved: 1, orphaned: 1 }),
		);
	});

	it("writes one reader's rows on two copies of a paragraph onto the one copy left", () => {
		const copy = "A repeated paragraph of words.";
		const oldText = `${copy}\nMiddle.\n${copy}`;
		const first = rowOn({ highlightId: "first", text: oldText, passage: copy });
		const second = rowOn({
			highlightId: "second",
			text: oldText,
			passage: copy,
			occurrence: "last",
		});

		const result = reanchorArticleHighlights({
			text: `Middle.\n${copy}`,
			contentHash: "new-hash",
			candidateId: NEW_CANDIDATE,
			highlights: [first, second],
			anchorTexts: new Map(),
		});

		assert.deepEqual(
			result.writes.map((write) => [write.anchor.start, write.anchor.end]),
			[
				[8, 38],
				[8, 38],
			],
		);
	});

	it("writes no candidate id when the article has none", () => {
		const row = rowOn({
			highlightId: "a",
			text: OLD_TEXT,
			passage: "stays put",
		});

		const [write] = reanchorArticleHighlights({
			text: OLD_TEXT,
			contentHash: "new-hash",
			candidateId: undefined,
			highlights: [row],
			anchorTexts: new Map(),
		}).writes;

		assert.equal("anchoredCandidateId" in write.anchor, false);
	});

	describe("against a basis body", () => {
		const BASIS =
			"The cat sat on the mat today. A dog ran across the yard quickly. Birds sang loudly in the morning sun.";

		function basisRow(params: {
			text: string;
			passage: string;
			extra?: Partial<Row>;
		}): Row {
			return {
				...rowOn({
					highlightId: "b",
					text: params.text,
					passage: params.passage,
				}),
				basisCandidateId: OLD_CANDIDATE,
				...params.extra,
			};
		}

		function placeOne(params: {
			row: Row;
			text: string;
			basis?: string;
			candidateId?: typeof NEW_CANDIDATE;
		}) {
			const result = reanchorArticleHighlights({
				text: params.text,
				contentHash: "new-hash",
				candidateId:
					"candidateId" in params ? params.candidateId : NEW_CANDIDATE,
				highlights: [params.row],
				anchorTexts: new Map(
					params.basis === undefined ? [] : [[OLD_CANDIDATE, params.basis]],
				),
			});
			const [write] = result.writes;
			const counted = Object.entries(result.counts).filter(
				([, value]) => value > 0,
			);
			return {
				anchor: write.anchor,
				words: params.text.slice(write.anchor.start, write.anchor.end),
				counts: Object.fromEntries(counted),
			};
		}

		it("carries a row across an inserted line and takes this version as its basis", () => {
			const text = `Intro line here. ${BASIS}`;
			const { anchor, counts } = placeOne({
				row: basisRow({ text: BASIS, passage: "dog ran across" }),
				text,
				basis: BASIS,
			});

			const start = text.indexOf("dog ran across");
			const { prefix, suffix } = describeRange({
				text,
				start,
				end: start + 14,
			});
			assert.deepEqual(anchor, {
				start,
				end: start + 14,
				anchorState: "moved",
				anchoredContentHash: "new-hash",
				anchoredCandidateId: NEW_CANDIDATE,
				basisCandidateId: NEW_CANDIDATE,
				prefix,
				suffix,
				orderKey: start,
			});
			assert.deepEqual(counts, { moved: 1, diffed: 1 });
		});

		it("anchors a row whose words and offsets are unchanged and stores no basis id without a candidate", () => {
			const { anchor, counts } = placeOne({
				row: basisRow({ text: BASIS, passage: "dog ran across" }),
				text: BASIS,
				basis: BASIS,
				candidateId: undefined,
			});

			assert.equal(anchor.anchorState, "anchored");
			assert.equal("basisCandidateId" in anchor, false);
			assert.deepEqual(counts, { anchored: 1, diffed: 1 });
		});

		it("stores the edited words as the basis quote", () => {
			const text = BASIS.replace("dog ran", "dog raced");
			const { anchor, words, counts } = placeOne({
				row: basisRow({ text: BASIS, passage: "dog ran across" }),
				text,
				basis: BASIS,
			});

			assert.equal(words, "dog raced across");
			assert.equal(anchor.basisQuote, "dog raced across");
			assert.deepEqual(counts, { moved: 1, diffed: 1, edited: 1 });
		});

		it("refuses a deleted sentence as gone and keeps the row's basis, words and offsets", () => {
			const row = basisRow({
				text: BASIS,
				passage: "dog ran across",
				extra: { basisQuote: "dog ran across" },
			});
			const { anchor, counts } = placeOne({
				row,
				text: BASIS.replace(" A dog ran across the yard quickly.", ""),
				basis: BASIS,
			});

			assert.deepEqual(anchor, {
				start: row.start,
				end: row.end,
				anchorState: "orphaned",
				anchoredContentHash: "new-hash",
				anchoredCandidateId: NEW_CANDIDATE,
				basisCandidateId: OLD_CANDIDATE,
				basisQuote: "dog ran across",
				orderKey: row.orderKey,
			});
			assert.deepEqual(counts, { orphaned: 1, diffed: 1, gone: 1 });
		});

		it("refuses a rewritten sentence as not placed", () => {
			const text = BASIS.replace(
				"A dog ran across the yard quickly.",
				"Completely different words entirely now.",
			);
			const { anchor, counts } = placeOne({
				row: basisRow({ text: BASIS, passage: "dog ran across the yard" }),
				text,
				basis: BASIS,
			});

			assert.equal(anchor.anchorState, "orphaned");
			assert.deepEqual(counts, { orphaned: 1, diffed: 1, notPlaced: 1 });
		});

		it("places a moved and edited sentence through the fallback", () => {
			const text =
				"Birds sang loudly in the morning sun. The cat sat on the mat today. A big dog ran across the yard very quickly.";
			const { words, counts } = placeOne({
				row: basisRow({ text: BASIS, passage: "dog ran across the yard" }),
				text,
				basis: BASIS,
			});

			assert.equal(words, "dog ran across the yard");
			assert.deepEqual(counts, { moved: 1, diffed: 1, placedByFallback: 1 });
		});

		it("places a row elsewhere when its sentence is gone and its words stand in a new sentence that holds it", () => {
			const copy = "Then a dog ran across the yard quickly.";
			const text = `The cat sat on the mat today. Birds sang loudly in the morning sun. ${copy} ${copy}`;
			const row = basisRow({
				text: BASIS,
				passage: "dog ran across the yard",
				extra: { basisQuote: "dog ran across the yard" },
			});
			const { anchor, counts } = placeOne({ row, text, basis: BASIS });

			assert.equal(anchor.start, text.indexOf("dog ran across the yard"));
			assert.deepEqual(counts, { moved: 1, diffed: 1, placedElsewhere: 1 });
		});

		it("places two edited rows in one sentence, judging that sentence once for both", () => {
			const text = BASIS.replace("dog ran", "dog raced");
			const result = reanchorArticleHighlights({
				text,
				contentHash: "new-hash",
				candidateId: NEW_CANDIDATE,
				highlights: [
					{
						...basisRow({ text: BASIS, passage: "dog ran across" }),
						highlightId: "one",
					},
					{
						...basisRow({ text: BASIS, passage: "ran across the yard" }),
						highlightId: "two",
					},
				],
				anchorTexts: new Map([[OLD_CANDIDATE, BASIS]]),
			});

			assert.deepEqual(
				result.writes.map(({ anchor }) =>
					text.slice(anchor.start, anchor.end),
				),
				["dog raced across", "raced across the yard"],
			);
		});

		it("keeps a row that holds only the space between two sentences", () => {
			const text = BASIS.replace("The cat", "A cat");
			const start = BASIS.indexOf(" A dog");
			const row: Row = {
				...basisRow({ text: BASIS, passage: "today." }),
				...describeRange({ text: BASIS, start, end: start + 1 }),
				orderKey: start,
			};
			const { anchor, counts } = placeOne({ row, text, basis: BASIS });

			assert.equal(anchor.anchorState, "orphaned");
			assert.deepEqual(counts, { orphaned: 1, diffed: 1, gone: 1 });
		});

		it("places a row on the copy left when its own copy was deleted", () => {
			const basis =
				"Hello there world. Middle words go here. Hello there world.";
			const text = "Middle words go here. Hello there world.";
			const { words, counts } = placeOne({
				row: basisRow({ text: basis, passage: "Hello there world." }),
				text,
				basis,
			});

			assert.equal(words, "Hello there world.");
			assert.deepEqual(counts, { moved: 1, diffed: 1 });
		});

		it("refuses a row whose basis does not hold its words, keeping its basis", () => {
			const row = basisRow({
				text: BASIS,
				passage: "dog ran across",
				extra: { exact: "zebra stripes", prefix: "", suffix: "" },
			});
			const { anchor, counts } = placeOne({ row, text: BASIS, basis: BASIS });

			assert.equal(anchor.anchorState, "orphaned");
			assert.equal(anchor.basisCandidateId, OLD_CANDIDATE);
			assert.deepEqual(counts, { orphaned: 1, notPlaced: 1 });
		});

		it("falls back to today's pass and drops the basis when its body was not read", () => {
			const row = basisRow({
				text: BASIS,
				passage: "dog ran across",
				extra: { basisQuote: "dog ran across" },
			});
			const placed = placeOne({ row, text: `Intro. ${BASIS}` });
			const lost = placeOne({ row, text: "Nothing alike." });

			assert.equal(placed.words, "dog ran across");
			assert.equal("basisCandidateId" in placed.anchor, false);
			assert.equal("basisQuote" in placed.anchor, false);
			assert.deepEqual(placed.counts, { moved: 1, basisMissing: 1 });
			assert.equal("basisCandidateId" in lost.anchor, false);
			assert.equal("basisQuote" in lost.anchor, false);
			assert.deepEqual(lost.counts, { orphaned: 1, basisMissing: 1 });
		});

		it("grants a row with no basis its anchor's body when it is relocated there", () => {
			const row = {
				...rowOn({ highlightId: "g", text: BASIS, passage: "dog ran across" }),
			};
			const placed = placeOne({ row, text: `Intro. ${BASIS}`, basis: BASIS });
			const refused = placeOne({ row, text: "Nothing alike.", basis: BASIS });

			assert.equal(placed.anchor.basisCandidateId, NEW_CANDIDATE);
			assert.deepEqual(placed.counts, { moved: 1, diffed: 1, basisGranted: 1 });
			assert.equal(refused.anchor.basisCandidateId, OLD_CANDIDATE);
			assert.deepEqual(refused.counts, {
				orphaned: 1,
				diffed: 1,
				gone: 1,
				basisGranted: 1,
			});
		});

		it("uses today's pass for a row with no basis that its anchor's body does not hold", () => {
			const row = {
				...rowOn({ highlightId: "t", text: BASIS, passage: "dog ran across" }),
				exact: "dog ran fast",
				prefix: "",
				suffix: "",
			};
			const { anchor, counts } = placeOne({
				row,
				text: "A dog ran fast.",
				basis: BASIS,
			});

			assert.equal(anchor.anchorState, "moved");
			assert.equal("basisCandidateId" in anchor, false);
			assert.deepEqual(counts, { moved: 1 });
		});

		it("stores an edited basis quote for a fuzzy match of today's pass", () => {
			const row = {
				...rowOn({
					highlightId: "t",
					text: BASIS,
					passage: "A dog ran across the yard quickly.",
				}),
				anchoredCandidateId: undefined,
			};
			const text = BASIS.replace("ran across", "ran acros");
			const { anchor, counts } = placeOne({ row, text });

			assert.equal(anchor.basisQuote, text.slice(anchor.start, anchor.end));
			assert.deepEqual(counts, { moved: 1, edited: 1 });
		});

		it("places every row that shares one basis body", () => {
			const text =
				"Birds sang loudly in the morning sun. The cat sat on the mat today. A big dog ran across the yard very quickly.";
			const row = basisRow({ text: BASIS, passage: "dog ran across the yard" });
			const result = reanchorArticleHighlights({
				text,
				contentHash: "new-hash",
				candidateId: NEW_CANDIDATE,
				highlights: [row, { ...row, highlightId: "c" }],
				anchorTexts: new Map([[OLD_CANDIDATE, BASIS]]),
			});

			assert.deepEqual(
				result.writes.map((write) =>
					text.slice(write.anchor.start, write.anchor.end),
				),
				["dog ran across the yard", "dog ran across the yard"],
			);
			assert.equal(result.counts.placedByFallback, 2);
		});
	});
});
