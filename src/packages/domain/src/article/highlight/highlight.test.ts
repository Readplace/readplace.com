import assert from "node:assert/strict";
import {
	AnchorStateSchema,
	HIGHLIGHT_NOTE_MAX_LENGTH,
	HighlightIdSchema,
	HighlightNoteSchema,
	joinNotesNewestFirst,
} from "./highlight";

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

describe("joinNotesNewestFirst", () => {
	it("joins every present note in the order given, separated by blank lines", () => {
		assert.deepEqual(joinNotesNewestFirst(["request", undefined, "newest row", "oldest row"]), {
			ok: true,
			note: "request\n\nnewest row\n\noldest row",
		});
	});

	it("keeps a lone note as it is", () => {
		assert.deepEqual(joinNotesNewestFirst([undefined, "old"]), { ok: true, note: "old" });
	});

	it("leaves the note absent when every note is absent", () => {
		assert.deepEqual(joinNotesNewestFirst([undefined, undefined]), { ok: true });
	});

	it("accepts a join of exactly the maximum length", () => {
		const newer = "a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH - 3);
		assert.deepEqual(joinNotesNewestFirst([newer, "b"]), { ok: true, note: `${newer}\n\nb` });
	});

	it("refuses notes that join past the cap", () => {
		assert.deepEqual(joinNotesNewestFirst(["a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH - 3), "b", "c"]), { ok: false });
	});
});
