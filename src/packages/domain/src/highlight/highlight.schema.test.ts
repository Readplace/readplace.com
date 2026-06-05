import {
	CreateHighlightInputSchema,
	HighlightAnchorSchema,
	HighlightIdSchema,
	MAX_HIGHLIGHT_NOTE_LENGTH,
	MAX_HIGHLIGHT_QUOTE_LENGTH,
	UpdateHighlightNoteSchema,
} from "./highlight.schema";

describe("HighlightIdSchema", () => {
	it("accepts a 32-char lowercase hex id", () => {
		const id = "0123456789abcdef0123456789abcdef";
		expect(HighlightIdSchema.parse(id)).toBe(id);
	});

	it("rejects ids that are not 32-char hex", () => {
		expect(HighlightIdSchema.safeParse("nope").success).toBe(false);
		expect(HighlightIdSchema.safeParse("ABCDEF").success).toBe(false);
	});
});

describe("HighlightAnchorSchema", () => {
	it("accepts a well-formed anchor", () => {
		const parsed = HighlightAnchorSchema.parse({ start: 2, end: 7, quote: "hello" });
		expect(parsed).toEqual({ start: 2, end: 7, quote: "hello" });
	});

	it("rejects an anchor whose end is not past its start", () => {
		expect(HighlightAnchorSchema.safeParse({ start: 5, end: 5, quote: "x" }).success).toBe(false);
		expect(HighlightAnchorSchema.safeParse({ start: 9, end: 4, quote: "x" }).success).toBe(false);
	});

	it("rejects an empty quote", () => {
		expect(HighlightAnchorSchema.safeParse({ start: 0, end: 1, quote: "" }).success).toBe(false);
	});

	it("rejects a quote longer than the maximum", () => {
		const quote = "a".repeat(MAX_HIGHLIGHT_QUOTE_LENGTH + 1);
		expect(HighlightAnchorSchema.safeParse({ start: 0, end: 1, quote }).success).toBe(false);
	});
});

describe("CreateHighlightInputSchema", () => {
	it("coerces string offsets from form bodies and keeps an optional note", () => {
		const parsed = CreateHighlightInputSchema.parse({
			start: "3",
			end: "8",
			quote: "world",
			note: "a thought",
		});
		expect(parsed).toEqual({ start: 3, end: 8, quote: "world", note: "a thought" });
	});

	it("accepts input without a note", () => {
		const parsed = CreateHighlightInputSchema.parse({ start: 0, end: 4, quote: "free" });
		expect(parsed.note).toBeUndefined();
	});

	it("rejects input whose end is not past its start", () => {
		expect(
			CreateHighlightInputSchema.safeParse({ start: 4, end: 4, quote: "x" }).success,
		).toBe(false);
	});

	it("rejects a note longer than the maximum", () => {
		const note = "n".repeat(MAX_HIGHLIGHT_NOTE_LENGTH + 1);
		expect(
			CreateHighlightInputSchema.safeParse({ start: 0, end: 1, quote: "x", note }).success,
		).toBe(false);
	});
});

describe("UpdateHighlightNoteSchema", () => {
	it("accepts a note within the length limit, including empty (clears the note)", () => {
		expect(UpdateHighlightNoteSchema.parse({ note: "" }).note).toBe("");
		expect(UpdateHighlightNoteSchema.parse({ note: "kept" }).note).toBe("kept");
	});

	it("rejects a note longer than the maximum", () => {
		const note = "n".repeat(MAX_HIGHLIGHT_NOTE_LENGTH + 1);
		expect(UpdateHighlightNoteSchema.safeParse({ note }).success).toBe(false);
	});
});
