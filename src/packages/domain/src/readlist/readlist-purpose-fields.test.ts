import assert from "node:assert/strict";
import { parseReadlistPurposeFields } from "./readlist-purpose-fields";

describe("parseReadlistPurposeFields", () => {
	it("splits the keep line from the skip line", () => {
		assert.deepEqual(parseReadlistPurposeFields("Keep articles about: hiring\nSkip: job ads"), {
			keep: "hiring",
			skip: "job ads",
		});
	});

	it("reads text without the prefixes as all keep", () => {
		assert.deepEqual(parseReadlistPurposeFields("Engineering management\nand hiring"), {
			keep: "Engineering management\nand hiring",
		});
	});

	it("keeps every line before the skip line in keep", () => {
		assert.deepEqual(parseReadlistPurposeFields("Keep articles about: hiring\none-on-ones\nSkip: job ads\nevent promos"), {
			keep: "hiring\none-on-ones",
			skip: "job ads\nevent promos",
		});
	});

	it("reads a keep line with no skip line as keep only", () => {
		assert.deepEqual(parseReadlistPurposeFields("Keep articles about: hiring\none-on-ones"), {
			keep: "hiring\none-on-ones",
		});
	});

	it("splits CRLF input as a textarea submits it", () => {
		assert.deepEqual(parseReadlistPurposeFields("Keep articles about: hiring\r\nSkip: job ads"), {
			keep: "hiring",
			skip: "job ads",
		});
	});

	it("reads a first line beginning with Skip as all keep", () => {
		assert.deepEqual(parseReadlistPurposeFields("Skip: job ads"), { keep: "Skip: job ads" });
	});

	it("reads a bare keep prefix as an empty keep", () => {
		assert.deepEqual(parseReadlistPurposeFields("Keep articles about: "), { keep: "" });
	});
});
