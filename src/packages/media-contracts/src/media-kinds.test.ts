import assert from "node:assert/strict";
import { BOOK } from "./kinds/book";
import { MEDIA_KINDS, MediaKindNameSchema } from "./media-kinds";

describe("MEDIA_KINDS", () => {
	it("holds a manifest for the book kind only", () => {
		assert.deepEqual([...MEDIA_KINDS.keys()], ["book"]);
	});

	it("holds the book manifest under its own name", () => {
		assert.equal(MEDIA_KINDS.get("book"), BOOK);
	});
});

describe("MediaKindNameSchema", () => {
	it("names the book and audio kinds", () => {
		assert.deepEqual(MediaKindNameSchema.options, ["book", "audio"]);
	});

	it("refuses a name that is not a kind", () => {
		assert.equal(MediaKindNameSchema.safeParse("pamphlet").success, false);
	});
});
