import assert from "node:assert/strict";
import { EnclosureSchema } from "./enclosure";

const SHA = "0123456789abcdef".repeat(4);

describe("EnclosureSchema", () => {
	it("accepts a content-addressed object with an audio type and a duration", () => {
		assert.deepEqual(EnclosureSchema.parse({ object: `objects/sha256/${SHA}/1`, mediaType: "audio/mpeg", durationSeconds: 2820 }), {
			object: `objects/sha256/${SHA}/1`,
			mediaType: "audio/mpeg",
			durationSeconds: 2820,
		});
	});

	it("refuses an object key without its sha256 digest and generation", () => {
		assert.equal(EnclosureSchema.safeParse({ object: "pending/0123456789abcdef0123456789abcdef/original", mediaType: "audio/mpeg", durationSeconds: 2820 }).success, false);
	});

	it("refuses audio/x-m4a as a media type", () => {
		assert.equal(EnclosureSchema.safeParse({ object: `objects/sha256/${SHA}/1`, mediaType: "audio/x-m4a", durationSeconds: 2820 }).success, false);
	});
});
