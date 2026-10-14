import { DISPLAY_NAME_MAX_LENGTH, parseDisplayNameInput } from "./display-name";

describe("parseDisplayNameInput", () => {
	it("keeps a name as typed once the surrounding spaces are trimmed", () => {
		expect(parseDisplayNameInput("  Mary  Jane Watson ")).toEqual({ ok: true, displayName: "Mary  Jane Watson" });
	});

	it("clears the name for a blank or whitespace-only value", () => {
		expect(parseDisplayNameInput("")).toEqual({ ok: true, displayName: undefined });
		expect(parseDisplayNameInput(" \t ")).toEqual({ ok: true, displayName: undefined });
	});

	it("accepts a name at the length limit and refuses one past it", () => {
		expect(DISPLAY_NAME_MAX_LENGTH).toBe(64);
		expect(parseDisplayNameInput("a".repeat(64))).toEqual({ ok: true, displayName: "a".repeat(64) });
		expect(parseDisplayNameInput("a".repeat(65))).toEqual({ ok: false, reason: "too-long" });
	});
});
