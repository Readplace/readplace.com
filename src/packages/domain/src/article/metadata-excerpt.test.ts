import assert from "node:assert/strict";
import { clipMetadataExcerpt } from "./metadata-excerpt";

describe("clipMetadataExcerpt", () => {
	it("returns a text no longer than the cap unchanged", () => {
		assert.equal(clipMetadataExcerpt("x".repeat(240)), "x".repeat(240));
	});

	it("cuts a longer text at the last space inside the cap and appends an ellipsis", () => {
		assert.equal(clipMetadataExcerpt("abcdefghi ".repeat(30).trim()), `${"abcdefghi ".repeat(24).trim()}…`);
	});

	it("cuts at the cap when the text has no space", () => {
		assert.equal(clipMetadataExcerpt("x".repeat(300)), `${"x".repeat(240)}…`);
	});
});
