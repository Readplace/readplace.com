import assert from "node:assert/strict";
import {
	AnchorStateSchema,
	HIGHLIGHT_NOTE_MAX_LENGTH,
	HighlightIdSchema,
	HighlightNoteSchema,
	joinNotes,
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

describe("joinNotes", () => {
	it("puts the newer note first, separated by a blank line", () => {
		assert.deepEqual(joinNotes({ newer: "new", older: "old" }), {
			ok: true,
			note: "new\n\nold",
		});
	});

	it("keeps the older note when the newer is absent", () => {
		assert.deepEqual(joinNotes({ older: "old" }), { ok: true, note: "old" });
	});

	it("keeps the newer note when the older is absent", () => {
		assert.deepEqual(joinNotes({ newer: "new" }), { ok: true, note: "new" });
	});

	it("leaves the note absent when both sides are absent", () => {
		assert.deepEqual(joinNotes({}), { ok: true });
	});

	it("accepts a join of exactly the maximum length", () => {
		const newer = "a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH - 3);
		assert.deepEqual(joinNotes({ newer, older: "b" }), {
			ok: true,
			note: `${newer}\n\nb`,
		});
	});

	it("refuses a join over the maximum length instead of truncating it", () => {
		const newer = "a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH - 2);
		assert.deepEqual(joinNotes({ newer, older: "b" }), { ok: false });
	});

	it("folds three notes pairwise, newest first", () => {
		const first = joinNotes({ newer: "request", older: "newest row" });
		assert.equal(first.ok, true);
		assert(first.ok);
		assert.deepEqual(joinNotes({ newer: first.note, older: "oldest row" }), {
			ok: true,
			note: "request\n\nnewest row\n\noldest row",
		});
	});
});
