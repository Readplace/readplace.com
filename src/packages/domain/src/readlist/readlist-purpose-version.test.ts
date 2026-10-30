import assert from "node:assert/strict";
import { readlistPurposeVersion } from "./readlist-purpose-version";

describe("readlistPurposeVersion", () => {
	it("is twelve lowercase hex characters", () => {
		assert.match(readlistPurposeVersion("Keep articles about: hiring"), /^[0-9a-f]{12}$/);
	});

	it("is stable for the same text", () => {
		assert.equal(readlistPurposeVersion("Keep articles about: hiring"), readlistPurposeVersion("Keep articles about: hiring"));
	});

	it("changes when one character changes", () => {
		assert.notEqual(readlistPurposeVersion("Keep articles about: hiring"), readlistPurposeVersion("Keep articles about: hiringx"));
	});
});
