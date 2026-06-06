import { HighlightIdSchema } from "./highlight.schema";

describe("HighlightIdSchema", () => {
	it("brands a string as HighlightId", () => {
		expect(HighlightIdSchema.parse("highlight-123")).toBe("highlight-123");
	});

	it("rejects non-strings", () => {
		expect(HighlightIdSchema.safeParse(42).success).toBe(false);
	});
});
