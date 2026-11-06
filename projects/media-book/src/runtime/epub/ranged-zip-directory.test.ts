import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { buildTestEpub } from "./build-test-epub";
import { readRangedZipDirectory, ZIP_TAIL_BYTES } from "./ranged-zip-directory";
import { readRangesOf } from "./ranged-zip-test-reader";
import { listZipEntries } from "./zip-entries";

const LARGE_BOOK = buildTestEpub({
	title: "Pictures",
	chapters: [{ file: "one.xhtml", title: "One", body: "<p>a</p>" }],
	images: [{ file: "big.png", mediaType: "image/png", bytes: new Uint8Array(randomBytes(200_000)) }],
});

describe("readRangedZipDirectory", () => {
	it("finds the end record in the file's tail and lists every entry from one read of the central directory", async () => {
		const { readRange, ranges } = readRangesOf(LARGE_BOOK);

		const entries = await readRangedZipDirectory(readRange);

		assert.notEqual(entries, "not-a-zip");
		assert.deepEqual(typeof entries === "string" ? [] : entries.map((entry) => entry.name), listZipEntries(LARGE_BOOK));
		assert.equal(ranges.length, 2);
		assert.deepEqual(ranges[0], { suffixLength: ZIP_TAIL_BYTES });
		assert.ok(LARGE_BOOK.byteLength > ZIP_TAIL_BYTES);
	});

	it("records each entry's compression method, compressed size and local header offset", async () => {
		const bytes = zipSync({ stored: [strToU8("plain"), { level: 0 }], deflated: [strToU8("x".repeat(100)), { level: 9 }] });

		const entries = await readRangedZipDirectory(readRangesOf(bytes).readRange);

		assert.notEqual(entries, "not-a-zip");
		const [stored, deflated] = typeof entries === "string" ? [] : entries;
		assert.deepEqual(stored, { name: "stored", method: 0, compressedSize: 5, localHeaderOffset: 0 });
		assert.equal(deflated?.method, 8);
		assert.ok(deflated !== undefined && deflated.compressedSize < 100 && deflated.localHeaderOffset > 0);
	});

	it("lists no entries in an empty zip without reading a central directory", async () => {
		const { readRange, ranges } = readRangesOf(zipSync({}));

		assert.deepEqual(await readRangedZipDirectory(readRange), []);
		assert.equal(ranges.length, 1);
	});

	it("refuses a file with no end record", async () => {
		assert.equal(await readRangedZipDirectory(readRangesOf(strToU8("not a zip at all, just some text")).readRange), "not-a-zip");
	});

	it.each([
		["the tail", 0],
		["the central directory", 1],
	])("reports the staged bytes gone when %s cannot be read", async (_, goneAt) => {
		const { readRange } = readRangesOf(LARGE_BOOK);
		let reads = 0;

		const entries = await readRangedZipDirectory(async (range) => (reads++ === goneAt ? "staged-bytes-gone" : readRange(range)));

		assert.equal(entries, "staged-bytes-gone");
	});
});
