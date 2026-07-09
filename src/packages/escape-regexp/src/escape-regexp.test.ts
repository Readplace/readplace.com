import assert from "node:assert/strict";
import { escapeRegExp } from "./escape-regexp";

const METACHARACTERS = [..."\\^$.*+?()[]{}|"];

describe("escapeRegExp", () => {
	it("prefixes every regex metacharacter with a backslash", () => {
		for (const char of METACHARACTERS) {
			assert.equal(escapeRegExp(char), `\\${char}`, `should escape ${char}`);
		}
	});

	it("leaves a string with no metacharacters unchanged", () => {
		assert.equal(
			escapeRegExp("delete my account permanently"),
			"delete my account permanently",
		);
	});

	it("escaped output matches the original literally and nothing else", () => {
		const literal = "v1.2 (beta)? a+b*";
		const anchored = new RegExp(`^${escapeRegExp(literal)}$`);
		assert.match(literal, anchored);
		assert.doesNotMatch("vX2 Xbeta)? aXbXb", anchored);
	});

	it("returns an empty string for empty input", () => {
		assert.equal(escapeRegExp(""), "");
	});
});
