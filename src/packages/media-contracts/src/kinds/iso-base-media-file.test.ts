import assert from "node:assert/strict";
import { isIsoBaseMediaFile } from "./iso-base-media-file";

function box(params: { size: number; type: string; length: number }): Uint8Array {
	const bytes = Buffer.alloc(params.length);
	bytes.writeUInt32BE(params.size, 0);
	bytes.write(params.type, 4, "latin1");
	return bytes;
}

describe("isIsoBaseMediaFile", () => {
	it("recognises a file that opens with an ftyp box", () => {
		assert.equal(isIsoBaseMediaFile(box({ size: 0x20, type: "ftyp", length: 32 })), true);
	});

	it("recognises an ftyp box of the smallest size", () => {
		assert.equal(isIsoBaseMediaFile(box({ size: 16, type: "ftyp", length: 16 })), true);
	});

	it("refuses an ftyp box whose size is under 16 bytes", () => {
		assert.equal(isIsoBaseMediaFile(box({ size: 15, type: "ftyp", length: 32 })), false);
	});

	it("refuses a file whose first box is not ftyp", () => {
		assert.equal(isIsoBaseMediaFile(box({ size: 0x20, type: "moov", length: 32 })), false);
	});

	it("refuses a buffer shorter than 16 bytes", () => {
		assert.equal(isIsoBaseMediaFile(box({ size: 0x20, type: "ftyp", length: 15 })), false);
	});

	it("reads the box from a view that starts inside a larger buffer", () => {
		const backing = Buffer.concat([Buffer.alloc(3), box({ size: 0x20, type: "ftyp", length: 32 })]);
		assert.equal(isIsoBaseMediaFile(new Uint8Array(backing.buffer, backing.byteOffset + 3, 32)), true);
	});
});
