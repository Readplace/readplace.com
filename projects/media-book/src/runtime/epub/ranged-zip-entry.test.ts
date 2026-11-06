import assert from "node:assert/strict";
import { strFromU8, strToU8, zipSync } from "fflate";
import { readRangedZipDirectory } from "./ranged-zip-directory";
import { readRangedZipEntry } from "./ranged-zip-entry";
import { readRangesOf } from "./ranged-zip-test-reader";

const BYTES = zipSync({
	mimetype: [strToU8("application/epub+zip"), { level: 0 }],
	"OEBPS/content.opf": [strToU8(`<package>${"<item/>".repeat(50)}</package>`), { level: 9 }],
});

async function entryNamed(name: string) {
	const entries = await readRangedZipDirectory(readRangesOf(BYTES).readRange);
	const entry = typeof entries === "string" ? undefined : entries.find((candidate) => candidate.name === name);
	assert(entry, `${name} is listed`);
	return entry;
}

describe("readRangedZipEntry", () => {
	it.each([
		["stored", "mimetype", "application/epub+zip"],
		["deflated", "OEBPS/content.opf", `<package>${"<item/>".repeat(50)}</package>`],
	])("reads a %s entry back to its bytes with one ranged read", async (_, name, content) => {
		const { readRange, ranges } = readRangesOf(BYTES);

		const bytes = await readRangedZipEntry({ readRange, entry: await entryNamed(name) });

		assert.equal(typeof bytes === "string" ? bytes : strFromU8(bytes), content);
		assert.equal(ranges.length, 1);
	});

	it("reports the staged bytes gone when the entry cannot be read", async () => {
		const entry = await entryNamed("mimetype");

		assert.equal(await readRangedZipEntry({ readRange: async () => "staged-bytes-gone", entry }), "staged-bytes-gone");
	});
});
