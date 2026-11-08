import assert from "node:assert/strict";
import { locateQuote } from "./locate-quote";

describe("locateQuote", () => {
	it("finds a quote that occurs once", () => {
		const text = "Readplace keeps the passages you highlight.";

		const location = locateQuote({ text, quote: "the passages" });

		assert.deepEqual(location, { status: "found", start: 16, end: 28 });
	});

	it("folds curly quotes, dashes and whitespace in the quote", () => {
		const text = `She said "it's done" - then left.`;

		const location = locateQuote({
			text,
			quote: "  “it’s   done”\t— then ",
		});

		assert.deepEqual(location, { status: "found", start: 9, end: 27 });
	});

	it("reports a quote that is not in the text", () => {
		const location = locateQuote({
			text: "Readplace keeps the passages you highlight.",
			quote: "passages you forget",
		});

		assert.deepEqual(location, { status: "not-found" });
	});

	it("reports how many times an ambiguous quote occurs", () => {
		const location = locateQuote({
			text: "read it later. Then read it again.",
			quote: "read it",
		});

		assert.deepEqual(location, { status: "ambiguous", matches: 2 });
	});

	it("picks the occurrence whose preceding text ends with text_before", () => {
		const text = "read it later. Then read it again.";

		const location = locateQuote({
			text,
			quote: "read it",
			textBefore: "later. Then",
		});

		assert.deepEqual(location, { status: "found", start: 20, end: 27 });
	});

	it("picks an occurrence by a text_before at its 200-character cap", () => {
		const lead = "x".repeat(199);
		const text = `alpha beta. ${lead}y beta.`;

		const location = locateQuote({
			text,
			quote: "beta",
			textBefore: `${lead}y`,
		});

		assert.deepEqual(location, {
			status: "found",
			start: 12 + 200 + 1,
			end: 12 + 200 + 1 + 4,
		});
	});

	it("stays ambiguous when text_before precedes every occurrence", () => {
		const location = locateQuote({
			text: "said yes, then said yes again",
			quote: "yes",
			textBefore: "said",
		});

		assert.deepEqual(location, { status: "ambiguous", matches: 2 });
	});

	it("treats a text_before that normalises to nothing as absent", () => {
		const location = locateQuote({
			text: "said yes, then said yes again",
			quote: "yes",
			textBefore: "   ",
		});

		assert.deepEqual(location, { status: "ambiguous", matches: 2 });
	});

	it("matches a quote spanning a block boundary on a newline or a space", () => {
		const text = "First paragraph ends.\nSecond begins here.";

		assert.deepEqual(
			locateQuote({ text, quote: "ends.\nSecond" }),
			{ status: "found", start: 16, end: 28 },
		);
		assert.deepEqual(
			locateQuote({ text, quote: "ends. Second" }),
			{ status: "found", start: 16, end: 28 },
		);
	});

	it("refuses a quote with no visible text", () => {
		assert.throws(
			() => locateQuote({ text: "Some text.", quote: " ​ " }),
			/locateQuote needs a quote with visible text/,
		);
	});
});
