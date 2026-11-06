import assert from "node:assert/strict";
import { AUDIO } from "./kinds/audio";
import { BOOK } from "./kinds/book";
import { MEDIA_KINDS, MediaKindNameSchema } from "./media-kinds";

describe("MEDIA_KINDS", () => {
	it("holds a manifest for the book and audio kinds only", () => {
		assert.deepEqual([...MEDIA_KINDS.keys()], ["book", "audio"]);
	});

	it("holds the book manifest under its own name", () => {
		assert.equal(MEDIA_KINDS.get("book"), BOOK);
	});

	it("holds the audio manifest under its own name", () => {
		assert.equal(MEDIA_KINDS.get("audio"), AUDIO);
	});
});

describe("MediaKindNameSchema", () => {
	it("names the book, audio and video kinds", () => {
		assert.deepEqual(MediaKindNameSchema.options, ["book", "audio", "video"]);
		assert.equal(MediaKindNameSchema.parse("video"), "video");
	});

	it("refuses a name that is not a kind", () => {
		assert.equal(MediaKindNameSchema.safeParse("pamphlet").success, false);
	});
});
