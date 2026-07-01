import { parsePollParam } from "./poll-param";

describe("parsePollParam", () => {
	it("parses a valid numeric poll cursor", () => {
		expect(parsePollParam("5", 300)).toBe(5);
	});

	it("treats a missing poll cursor as 0", () => {
		expect(parsePollParam(undefined, 300)).toBe(0);
	});

	it("coerces a non-numeric poll cursor to 0 so the budget check still applies", () => {
		expect(parsePollParam("abc", 300)).toBe(0);
	});

	it("coerces a negative poll cursor to 0", () => {
		expect(parsePollParam("-7", 300)).toBe(0);
	});

	it("coerces a fractional poll cursor to 0", () => {
		expect(parsePollParam("3.5", 300)).toBe(0);
	});

	it("rejects a repeated query param (array) as 0", () => {
		expect(parsePollParam(["1", "2"], 300)).toBe(0);
	});

	it("clamps a poll cursor beyond the budget to the maximum", () => {
		expect(parsePollParam("99999", 300)).toBe(300);
	});
});
