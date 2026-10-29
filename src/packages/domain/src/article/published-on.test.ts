import assert from "node:assert/strict";
import { publishedOnFrom } from "./published-on";

describe("publishedOnFrom", () => {
	it.each([
		["2025-10-08", "2025-10-08"],
		["2025-10-08 14:00:00", "2025-10-08"],
		["2025-10-08T14:00:00.000Z", "2025-10-08"],
		["  2025-10-08  ", "2025-10-08"],
		["2025-10-12T22:30:00-07:00", "2025-10-12"],
		["1946-08-31", "1946-08-31"],
	])("reads %s as the calendar date %s, as written", (raw, expected) => {
		assert.equal(publishedOnFrom(raw), expected);
	});

	it.each([
		["2025"],
		["October 8, 2025"],
		["12/10/2025"],
		["0000-00-00"],
		["2025-02-30"],
		["2025-02-29"],
		["2025-10-081"],
		["not a date"],
		[""],
	])("finds no calendar date in %j", (raw) => {
		assert.equal(publishedOnFrom(raw), undefined);
	});

	it("finds no calendar date in null or undefined", () => {
		assert.equal(publishedOnFrom(null), undefined);
		assert.equal(publishedOnFrom(undefined), undefined);
	});
});
