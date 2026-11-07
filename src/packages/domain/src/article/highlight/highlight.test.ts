import assert from "node:assert/strict";
import { AnchorStateSchema, HighlightIdSchema } from "./highlight";

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
