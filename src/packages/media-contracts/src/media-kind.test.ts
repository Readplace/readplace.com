import assert from "node:assert/strict";
import { defineMediaKind, type MediaKindManifest } from "./media-kind";

const MANIFEST: MediaKindManifest = {
	name: "book",
	label: "Book",
	accepts: { "application/epub+zip": [".epub"] },
	uploadCeilingBytes: 1024,
	ceilingLabel: "1 KB",
	sniff: () => true,
};

describe("defineMediaKind", () => {
	it("returns a frozen copy of the manifest", () => {
		const kind = defineMediaKind(MANIFEST);

		assert.deepEqual(kind, MANIFEST);
		assert.equal(Object.isFrozen(kind), true);
	});

	it("refuses a kind that accepts no media type", () => {
		assert.throws(() => defineMediaKind({ ...MANIFEST, accepts: {} }), /book accepts no media type/);
	});

	it("refuses a kind without a positive upload ceiling", () => {
		assert.throws(
			() => defineMediaKind({ ...MANIFEST, uploadCeilingBytes: 0 }),
			/book needs a positive upload ceiling/,
		);
	});
});
