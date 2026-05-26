import {
	checkDigitsPreserved,
	checkLength,
	checkWhitespaceStructure,
	evaluateGuardrails,
} from "./guardrails";

describe("checkLength", () => {
	it("accepts an identical-length pair", () => {
		expect(checkLength({ before: "hello world", after: "hello world" })).toBe(true);
	});

	it("accepts a 30%-shorter rewrite (boundary)", () => {
		const before = "x".repeat(100);
		const after = "x".repeat(70);
		expect(checkLength({ before, after })).toBe(true);
	});

	it("rejects a 31%-shorter rewrite", () => {
		const before = "x".repeat(100);
		const after = "x".repeat(69);
		expect(checkLength({ before, after })).toBe(false);
	});

	it("rejects a 31%-longer rewrite", () => {
		const before = "x".repeat(100);
		const after = "x".repeat(131);
		expect(checkLength({ before, after })).toBe(false);
	});

	it("treats two empty strings as preserved", () => {
		expect(checkLength({ before: "", after: "" })).toBe(true);
	});

	it("rejects any non-empty cleanup output for an empty original", () => {
		expect(checkLength({ before: "", after: "x" })).toBe(false);
	});
});

describe("checkDigitsPreserved", () => {
	it("accepts text with no digits in either version", () => {
		expect(checkDigitsPreserved({ before: "hello world", after: "hello earth" })).toBe(true);
	});

	it("accepts the same digit runs in the same positions", () => {
		expect(checkDigitsPreserved({ before: "page 12 of 34", after: "page 12 of 34" })).toBe(true);
	});

	it("accepts re-ordered digit runs (sort-stable comparison)", () => {
		// The model could not legitimately swap the order of citations, but the
		// guardrail does not enforce position — only the multiset of runs. The
		// stronger position check is left to the document-level Stage 2.
		expect(checkDigitsPreserved({ before: "12 34", after: "34 12" })).toBe(true);
	});

	it("rejects mutation of a digit within a run (1968 → 1986)", () => {
		expect(checkDigitsPreserved({ before: "year 1968", after: "year 1986" })).toBe(false);
	});

	it("rejects added digit runs (the model invented a citation)", () => {
		expect(checkDigitsPreserved({ before: "see page 5", after: "see page 5, also 42" })).toBe(false);
	});

	it("rejects dropped digit runs (the model deleted a citation)", () => {
		expect(checkDigitsPreserved({ before: "see page 5, also 42", after: "see page 5" })).toBe(false);
	});
});

describe("checkWhitespaceStructure", () => {
	it("accepts byte-identical input", () => {
		const text = "para one\n\npara two\n\npara three";
		expect(checkWhitespaceStructure({ before: text, after: text })).toBe(true);
	});

	it("accepts text where only words within paragraphs change", () => {
		const before = "para one\n\npara two";
		const after = "fixed one\n\nfixed two";
		expect(checkWhitespaceStructure({ before, after })).toBe(true);
	});

	it("rejects a merged paragraph break (the model joined two paragraphs)", () => {
		const before = "line one\n\nline two";
		const after = "line one line two";
		expect(checkWhitespaceStructure({ before, after })).toBe(false);
	});

	it("rejects a split paragraph (the model added a paragraph break)", () => {
		const before = "one sentence two sentence";
		const after = "one sentence\n\ntwo sentence";
		expect(checkWhitespaceStructure({ before, after })).toBe(false);
	});

	it("rejects extra line breaks even without blank-line changes", () => {
		const before = "alpha beta gamma";
		const after = "alpha\nbeta\ngamma";
		expect(checkWhitespaceStructure({ before, after })).toBe(false);
	});

	it("ignores trailing whitespace differences (model dropped the final newline)", () => {
		const before = "para one\n\npara two\n";
		const after = "para one\n\npara two";
		expect(checkWhitespaceStructure({ before, after })).toBe(true);
	});
});

describe("evaluateGuardrails", () => {
	it("returns null when every check passes", () => {
		expect(evaluateGuardrails({ before: "page 1 text", after: "page 1 text" })).toBeNull();
	});

	it("returns 'length-delta-exceeded' when the rewrite is too short", () => {
		const before = "x".repeat(100);
		const after = "x".repeat(40);
		expect(evaluateGuardrails({ before, after })).toBe("length-delta-exceeded");
	});

	it("returns 'digits-mutated' when length is fine but a digit changed", () => {
		expect(evaluateGuardrails({ before: "year 1968", after: "year 1986" })).toBe("digits-mutated");
	});

	it("returns 'whitespace-structure-changed' when length and digits are fine but paragraphs merged", () => {
		const before = "alpha\n\nbeta";
		const after = "alpha beta";
		expect(evaluateGuardrails({ before, after })).toBe("whitespace-structure-changed");
	});
});
