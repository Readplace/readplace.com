import assert from "node:assert/strict";
import { obsidianHandoffHref, parseObsidianHandoffQuery } from "./obsidian-handoff";

describe("parseObsidianHandoffQuery", () => {
	it("reads a code with its state", () => {
		expect(parseObsidianHandoffQuery({ code: "abc", state: "xyz" })).toEqual({ kind: "code", code: "abc", state: "xyz" });
	});

	it("reads an error with its state", () => {
		expect(parseObsidianHandoffQuery({ error: "access_denied", state: "xyz" })).toEqual({
			kind: "error",
			error: "access_denied",
			state: "xyz",
		});
	});

	it("treats state as optional in the code variant", () => {
		expect(parseObsidianHandoffQuery({ code: "abc" })).toEqual({ kind: "code", code: "abc", state: undefined });
	});

	it("treats state as optional in the error variant", () => {
		expect(parseObsidianHandoffQuery({ error: "access_denied" })).toEqual({
			kind: "error",
			error: "access_denied",
			state: undefined,
		});
	});

	it("prefers the code when both a code and an error arrive", () => {
		expect(parseObsidianHandoffQuery({ code: "abc", error: "access_denied" })).toEqual({
			kind: "code",
			code: "abc",
			state: undefined,
		});
	});

	it("ignores any other key", () => {
		expect(parseObsidianHandoffQuery({ code: "abc", error_description: "ignored", target: "https://evil.example" })).toEqual({
			kind: "code",
			code: "abc",
			state: undefined,
		});
	});

	it.each([
		["neither a code nor an error", { state: "xyz" }],
		["an error with an uppercase letter", { error: "Access_Denied" }],
		["an error with a space", { error: "a b" }],
		["a 300-character code", { code: "a".repeat(300) }],
		["a repeated code", { code: ["one", "two"] }],
	])("refuses %s", (_name, query) => {
		expect(parseObsidianHandoffQuery(query)).toEqual({ kind: "invalid" });
	});
});

describe("obsidianHandoffHref", () => {
	it("targets the Obsidian action with the code and state", () => {
		expect(obsidianHandoffHref({ kind: "code", code: "abc", state: "xyz" })).toBe("obsidian://readplace-auth?code=abc&state=xyz");
	});

	it("targets the Obsidian action with the error and state", () => {
		expect(obsidianHandoffHref({ kind: "error", error: "access_denied", state: "xyz" })).toBe(
			"obsidian://readplace-auth?error=access_denied&state=xyz",
		);
	});

	it("leaves state out when the query had none", () => {
		expect(obsidianHandoffHref({ kind: "code", code: "abc", state: undefined })).toBe("obsidian://readplace-auth?code=abc");
	});

	it("encodes a value so it cannot add a parameter", () => {
		const href = obsidianHandoffHref({ kind: "code", code: "a&redirect=https://evil.example", state: undefined });

		const params = new URL(href).searchParams;
		assert.equal(params.get("code"), "a&redirect=https://evil.example");
		expect(Array.from(params.keys())).toEqual(["code"]);
	});
});
