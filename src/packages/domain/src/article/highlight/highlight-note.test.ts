import assert from "node:assert/strict";
import { cleanHighlightNote, HIGHLIGHT_NOTE_MAX_LENGTH, joinNotesNewestFirst } from "./highlight-note";

describe("cleanHighlightNote", () => {
	it("leaves the note absent when none was given", () => {
		assert.equal(cleanHighlightNote(undefined), undefined);
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
