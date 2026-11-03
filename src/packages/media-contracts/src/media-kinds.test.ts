import assert from "node:assert/strict";
import { BOOK } from "./kinds/book";
import { MEDIA_KINDS, MediaKindNameSchema } from "./media-kinds";

describe("MEDIA_KINDS", () => {
	it("holds a manifest for every kind name", () => {
		assert.deepEqual([...MEDIA_KINDS.keys()], MediaKindNameSchema.options);
	});

	it("holds the book manifest under its own name", () => {
		assert.equal(MEDIA_KINDS.get("book"), BOOK);
	});
});

describe("MediaKindNameSchema", () => {
	it("refuses a name that is not a kind", () => {
		assert.equal(MediaKindNameSchema.safeParse("pamphlet").success, false);
	});
});
