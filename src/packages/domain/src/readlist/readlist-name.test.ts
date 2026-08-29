import assert from "node:assert/strict";
import {
	DEFAULT_READLIST_SLUG,
	READLIST_LABEL_MAX_LENGTH,
	READLIST_MAX_PER_USER,
	ReadlistLimitReachedError,
	parseReadlistLabel,
} from "./readlist-name.schema";

describe("parseReadlistLabel", () => {
	it("keeps the name as typed", () => {
		assert.equal(parseReadlistLabel("Work Reading"), "Work Reading");
	});

	it("trims the name the reader typed", () => {
		assert.equal(parseReadlistLabel("  Deep Work  "), "Deep Work");
	});

	it("accepts a name at the visible-width cap", () => {
		const label = "a".repeat(READLIST_LABEL_MAX_LENGTH);
		assert.equal(parseReadlistLabel(label), label);
	});

	it("rejects a name past the cap rather than truncating it to one the reader never typed", () => {
		assert.equal(parseReadlistLabel("a".repeat(READLIST_LABEL_MAX_LENGTH + 1)), undefined);
	});

	it("rejects a name with no characters in it", () => {
		assert.equal(parseReadlistLabel(""), undefined);
		assert.equal(parseReadlistLabel("   "), undefined);
	});

	it("takes a name made only of emoji, which the readlist's own id addresses", () => {
		assert.equal(parseReadlistLabel("🎉🎉"), "🎉🎉");
	});
});

describe("DEFAULT_READLIST_SLUG", () => {
	it("is the slug every readlist-less save and every unflagged view resolves to", () => {
		assert.equal(DEFAULT_READLIST_SLUG, "default");
	});
});

describe("ReadlistLimitReachedError", () => {
	it("carries the cap it was raised against and names it in the message", () => {
		const error = new ReadlistLimitReachedError(READLIST_MAX_PER_USER);
		assert.ok(error instanceof Error);
		assert.equal(error.name, "ReadlistLimitReachedError");
		assert.equal(error.limit, READLIST_MAX_PER_USER);
		assert.match(error.message, new RegExp(String(READLIST_MAX_PER_USER)));
	});
});
