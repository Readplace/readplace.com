import assert from "node:assert/strict";
import {
	anchorHighlightFuzzy,
	type FuzzyAnchorableHighlight,
} from "./anchor-highlight-fuzzy";
import { describeRange } from "./text-anchoring";

function highlightOn(params: {
	text: string;
	start: number;
	end: number;
	anchoredContentHash: string;
	anchorState: FuzzyAnchorableHighlight["anchorState"];
}): FuzzyAnchorableHighlight {
	return {
		...describeRange(params),
		anchoredContentHash: params.anchoredContentHash,
		anchorState: params.anchorState,
	};
}

describe("anchorHighlightFuzzy", () => {
	it("reaches the fuzzy pass when the exact pass misses", () => {
		const oldText =
			"Intro sentence here. The committee approved the new budget on Monday after a long debate. Closing remarks follow.";
		const newText =
			"Intro sentence here. The committee approved the new budget on Tuesday after a long debate. Closing remarks follow.";
		const highlight = highlightOn({
			text: oldText,
			start: 21,
			end: 89,
			anchoredContentHash: "old",
			anchorState: "anchored",
		});

		assert.deepEqual(
			anchorHighlightFuzzy({
				text: newText,
				contentHash: "new",
				highlight,
			}),
			{ start: 21, end: 90, anchorState: "moved" },
		);
	});

	it("keeps an orphaned row on the current hash orphaned without searching, though its old offsets hold its quote", () => {
		const text = "Alpha beta gamma delta.";
		const highlight = highlightOn({
			text,
			start: 6,
			end: 10,
			anchoredContentHash: "current",
			anchorState: "orphaned",
		});

		assert.deepEqual(
			anchorHighlightFuzzy({ text, contentHash: "current", highlight }),
			{ start: 6, end: 10, anchorState: "orphaned" },
		);
	});

	it("retries an orphaned row once the hash changes", () => {
		const text = "Alpha beta gamma delta.";
		const highlight = highlightOn({
			text,
			start: 6,
			end: 10,
			anchoredContentHash: "previous",
			anchorState: "orphaned",
		});

		assert.deepEqual(
			anchorHighlightFuzzy({ text, contentHash: "current", highlight }),
			{ start: 6, end: 10, anchorState: "anchored" },
		);
	});

	it("keeps a row on the second of two identical copies through the hash fast path, though prefix and suffix match the first better", () => {
		const text = "Alpha one. Same words. Beta two. Same words.";
		const second = text.lastIndexOf("Same words.");
		const highlight = {
			...highlightOn({
				text,
				start: second,
				end: second + 11,
				anchoredContentHash: "current",
				anchorState: "anchored",
			}),
			prefix: "Alpha one. ",
			suffix: " Beta two.",
		};

		assert.deepEqual(
			anchorHighlightFuzzy({ text, contentHash: "current", highlight }),
			{ start: second, end: second + 11, anchorState: "anchored" },
		);
	});

	it("returns the stored offsets as orphaned when neither pass finds the passage", () => {
		const highlight = highlightOn({
			text: "Before. A passage that was edited away entirely. After.",
			start: 8,
			end: 48,
			anchoredContentHash: "old",
			anchorState: "anchored",
		});

		assert.deepEqual(
			anchorHighlightFuzzy({
				text: "Something else stands here now.",
				contentHash: "new",
				highlight,
			}),
			{ start: 8, end: 48, anchorState: "orphaned" },
		);
	});
});
