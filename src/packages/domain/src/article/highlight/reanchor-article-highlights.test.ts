import assert from "node:assert/strict";
import { CandidateIdSchema } from "@packages/article-state-types";
import {
	type ReanchorableHighlight,
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
			}),
			{ writes: [], counts: { anchored: 0, moved: 0, orphaned: 0 } },
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
		assert.deepEqual(result.counts, { anchored: 1, moved: 0, orphaned: 0 });
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
		assert.deepEqual(result.counts, { anchored: 1, moved: 1, orphaned: 1 });
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
		}).writes;

		assert.equal("anchoredCandidateId" in write.anchor, false);
	});
});
