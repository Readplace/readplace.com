import assert from "node:assert/strict";
import { storedHighlightState } from "./stored-highlight-state";

const row = { exact: "the old bridge", anchoredContentHash: "h1" };

describe("storedHighlightState", () => {
	it("reads the stored state at the current hash", () => {
		assert.deepEqual(storedHighlightState({ highlight: { ...row, anchorState: "moved" }, contentHash: "h1" }), {
			state: "moved",
			edited: false,
			quote: "the old bridge",
		});
	});

	it("reads the stored state when the article has no snapshot", () => {
		assert.deepEqual(storedHighlightState({ highlight: { ...row, anchorState: "anchored" }, contentHash: undefined }), {
			state: "anchored",
			edited: false,
			quote: "the old bridge",
		});
	});

	it("reads pending at another hash", () => {
		assert.deepEqual(
			storedHighlightState({ highlight: { ...row, anchorState: "moved", basisQuote: "the old iron bridge" }, contentHash: "h2" }),
			{ state: "pending", edited: false, quote: "the old bridge" },
		);
	});

	it("shows the words at the current place of an edited row", () => {
		assert.deepEqual(
			storedHighlightState({ highlight: { ...row, anchorState: "moved", basisQuote: "the old iron bridge" }, contentHash: "h1" }),
			{ state: "moved", edited: true, quote: "the old iron bridge" },
		);
	});

	it("shows the reader's words on a row that was not found", () => {
		assert.deepEqual(
			storedHighlightState({ highlight: { ...row, anchorState: "orphaned", basisQuote: "the old iron bridge" }, contentHash: "h1" }),
			{ state: "orphaned", edited: false, quote: "the old bridge" },
		);
	});
});
