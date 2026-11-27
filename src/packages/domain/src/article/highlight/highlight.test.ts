import assert from "node:assert/strict";
import {
	AnchorStateSchema,
	HighlightIdSchema,
	HighlightNoteSchema,
} from "./highlight";
import { HIGHLIGHT_NOTE_MAX_LENGTH } from "./highlight-note";

describe("HighlightIdSchema", () => {
	it("accepts a uuid", () => {
		const id = "0b0e6f43-7d0f-4a5c-9a43-2f1c3a9d8e11";
		assert.equal(HighlightIdSchema.parse(id), id);
	});

	it("rejects a value that is not a uuid", () => {
		assert.equal(HighlightIdSchema.safeParse("highlight-1").success, false);
	});
});

describe("AnchorStateSchema", () => {
	it("accepts the three anchor states", () => {
		for (const state of ["anchored", "moved", "orphaned"]) {
			assert.equal(AnchorStateSchema.parse(state), state);
		}
	});

	it("rejects pending, which is a display state only", () => {
		assert.equal(AnchorStateSchema.safeParse("pending").success, false);
	});
});

describe("HighlightNoteSchema", () => {
	it("folds CRLF line breaks to LF and trims", () => {
		assert.equal(
			HighlightNoteSchema.parse("  first\r\nsecond\r\n "),
			"first\nsecond",
		);
	});

	it("turns a whitespace-only note into an absent note", () => {
		assert.equal(HighlightNoteSchema.parse(" \r\n\t "), undefined);
	});

	it("accepts a note of exactly the maximum length in UTF-16 code units", () => {
		const note = "a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH);
		assert.equal(HighlightNoteSchema.parse(note), note);
	});

	it("refuses a note one code unit over the maximum length", () => {
		assert.equal(
			HighlightNoteSchema.safeParse("a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH + 1))
				.success,
			false,
		);
	});

	it("counts a surrogate pair as two code units", () => {
		assert.equal(
			HighlightNoteSchema.safeParse(
				`${"a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH - 1)}😀`,
			).success,
			false,
		);
	});
});
