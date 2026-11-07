import assert from "node:assert/strict";
import search from "approx-string-match";
import { findFuzzyAnchor } from "./fuzzy-quote-match";

function positionOf(params: { text: string; passage: string }): {
	start: number;
	end: number;
} {
	const start = params.text.indexOf(params.passage);
	assert.ok(start >= 0, `"${params.passage}" must be in the text`);
	return { start, end: start + params.passage.length };
}

function wordsOfLength(length: number): string {
	let seed = 7;
	let text = "";
	while (text.length < length) {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		text += seed % 6 === 0 ? " " : String.fromCharCode(97 + (seed % 26));
	}
	return text;
}

function withSubstitutions(params: { text: string; count: number }): string {
	const step = Math.floor(params.text.length / params.count);
	const characters = [...params.text];
	for (let i = 0; i < params.count; i++) characters[i * step] = "Z";
	return characters.join("");
}

describe("findFuzzyAnchor", () => {
	it("moves a passage whose one word was edited onto its new offsets", () => {
		const passage =
			"The committee approved the new budget on Tuesday after a long debate.";
		const text = `Intro sentence here. ${passage} Closing remarks follow.`;

		const anchor = findFuzzyAnchor({
			text,
			selector: {
				exact:
					"The committee approved the new budget on Monday after a long debate.",
				prefix: "Intro sentence here. ",
				suffix: " Closing remarks follow.",
			},
			hintStart: 21,
		});

		assert.deepEqual(anchor, {
			...positionOf({ text, passage }),
			state: "moved",
		});
	});

	it("keeps a passage anchored at its shifted start when a paragraph is inserted before it", () => {
		const text =
			"Inserted paragraph.\nQuote at the start of things. Then more.";

		const anchor = findFuzzyAnchor({
			text,
			selector: {
				exact: "Quote at the start of things.",
				prefix: "",
				suffix: " Then more.",
			},
			hintStart: 0,
		});

		assert.deepEqual(anchor, { start: 20, end: 49, state: "anchored" });
	});

	it("picks the copy of two near-identical paragraphs whose prefix and suffix match", () => {
		const text =
			"Opening words one. The quick brown fox leaps over dogs. Ending words one.\nOpening words two. The quick brown fox leaps over dogs. Ending words two.";

		const anchor = findFuzzyAnchor({
			text,
			selector: {
				exact: "The quick brown fox jumps over dogs.",
				prefix: "Opening words two. ",
				suffix: " Ending words two.",
			},
			hintStart: 19,
		});

		const second = text.lastIndexOf("The quick brown fox leaps over dogs.");
		assert.deepEqual(anchor, {
			start: second,
			end: second + 36,
			state: "moved",
		});
	});

	it("orphans a passage whose runner-up scores within the gap of the best", () => {
		const copy =
			"Lead words here. Quote alpha beta gamma delte. Tail words here.";

		const anchor = findFuzzyAnchor({
			text: `${copy}\n${copy}`,
			selector: {
				exact: "Quote alpha beta gamma delta.",
				prefix: "Lead words here. ",
				suffix: " Tail words here.",
			},
			hintStart: 17,
		});

		assert.deepEqual(anchor, { state: "orphaned" });
	});

	it("orphans a passage whose quote similarity is below 0.80 though its context matches", () => {
		const anchor = findFuzzyAnchor({
			text: "Some context words before sever quack rod boxer some after words here",
			selector: {
				exact: "seven quick red foxes",
				prefix: "Some context words before ",
				suffix: " some after words here",
			},
			hintStart: 26,
		});

		assert.deepEqual(anchor, { state: "orphaned" });
	});

	it("orphans a passage whose prefix and suffix both changed", () => {
		const anchor = findFuzzyAnchor({
			text: "Zzz qqq xxx. The committee approved the new budget on Tuesday. Www yyy.",
			selector: {
				exact: "The committee approved the new budget on Monday.",
				prefix: "Our city news report, page one. ",
				suffix: " The mayor later said thanks.",
			},
			hintStart: 32,
		});

		assert.deepEqual(anchor, { state: "orphaned" });
	});

	it("orphans a passage whose quote and half its prefix match but whose overall score is below 0.80", () => {
		const anchor = findFuzzyAnchor({
			text: "abcdeVWXYZThe committee approved the new budget on Tuesday.1234567890",
			selector: {
				exact: "The committee approved the new budget on Tuesday.",
				prefix: "abcdefghij",
				suffix: "klmnopqrst",
			},
			hintStart: 10,
		});

		assert.deepEqual(anchor, { state: "orphaned" });
	});

	it("orphans a passage whose context still matches but whose quote is too damaged", () => {
		const anchor = findFuzzyAnchor({
			text: "Some context words before sxvxr qxack rxd bxxer some after words here",
			selector: {
				exact: "seven quick red foxes",
				prefix: "Some context words before ",
				suffix: " some after words here",
			},
			hintStart: 26,
		});

		assert.deepEqual(anchor, { state: "orphaned" });
	});

	it("orphans a passage with no near match at all", () => {
		assert.deepEqual(
			findFuzzyAnchor({
				text: "Nothing alike lives in this body of text.",
				selector: {
					exact: "A completely unrelated quotation appears",
					prefix: "",
					suffix: "",
				},
				hintStart: 0,
			}),
			{ state: "orphaned" },
		);
	});

	it("selects a candidate that only the prefix+exact+suffix search reaches", () => {
		const exact = "the quick brown fox jumps";
		const text =
			"Unrelated noise text, the quick brown fox jumpz into nothing at all. Chapter one begins here and the quack brawn fox jumps over the lazy dog today.";
		const contextual = text.indexOf("the quack brawn fox jumps");
		assert.ok(
			search(text, exact, 5).every((match) => match.start !== contextual),
			"the quote-only search must not reach the contextual candidate",
		);

		const anchor = findFuzzyAnchor({
			text,
			selector: {
				exact,
				prefix: "Chapter one begins here and ",
				suffix: " over the lazy dog today.",
			},
			hintStart: 0,
		});

		assert.deepEqual(anchor, {
			start: contextual,
			end: contextual + exact.length,
			state: "moved",
		});
	});

	describe("caps the allowed errors at 256", () => {
		const exact = wordsOfLength(2000);
		const selector = {
			exact,
			prefix: "Before the long passage ",
			suffix: " after the long passage",
		};

		it("finds a 2000-character quote with 250 substitutions", () => {
			const anchor = findFuzzyAnchor({
				text: `${selector.prefix}${withSubstitutions({ text: exact, count: 250 })}${selector.suffix}`,
				selector,
				hintStart: selector.prefix.length,
			});

			assert.equal(anchor.state, "moved");
		});

		it("orphans a 2000-character quote with 300 substitutions, which 20% alone would allow", () => {
			const anchor = findFuzzyAnchor({
				text: `${selector.prefix}${withSubstitutions({ text: exact, count: 300 })}${selector.suffix}`,
				selector,
				hintStart: selector.prefix.length,
			});

			assert.deepEqual(anchor, { state: "orphaned" });
		});
	});
});
