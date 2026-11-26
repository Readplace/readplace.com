import { highlightTextFragment } from "./highlight-text-fragment";

function fragmentOf(input: { pageText: string; passage: string; occurrence?: number }): string | undefined {
	let start = -1;
	for (let seen = 0; seen <= (input.occurrence ?? 0); seen++) {
		start = input.pageText.indexOf(input.passage, start + 1);
	}
	expect(start).toBeGreaterThanOrEqual(0);
	return highlightTextFragment({
		pageText: input.pageText,
		place: { start, end: start + input.passage.length },
	});
}

describe("highlightTextFragment", () => {
	it("names a short quote whole", () => {
		expect(fragmentOf({ pageText: "Alpha beta gamma delta.", passage: "beta gamma" })).toBe(
			"#:~:text=beta%20gamma",
		);
	});

	it("names a long quote in one block by its first and last six words", () => {
		const passage = "one two three four five six seven eight nine ten eleven twelve thirteen";
		expect(fragmentOf({ pageText: `Before. ${passage} after.`, passage })).toBe(
			"#:~:text=one%20two%20three%20four%20five%20six,eight%20nine%20ten%20eleven%20twelve%20thirteen",
		);
	});

	it("keeps an em dash and an en dash as the page writes them", () => {
		expect(fragmentOf({ pageText: "Wait — then 1990–1999 ended.", passage: "Wait — then 1990–1999" })).toBe(
			"#:~:text=Wait%20%E2%80%94%20then%201990%E2%80%931999",
		);
	});

	it("encodes a hyphen, an ampersand and a comma inside a term", () => {
		expect(fragmentOf({ pageText: "A well-known, cited A&B result.", passage: "well-known, cited A&B" })).toBe(
			"#:~:text=well%2Dknown%2C%20cited%20A%26B",
		);
	});

	it("drops whitespace at either end of the placed range", () => {
		expect(
			highlightTextFragment({ pageText: "Alpha beta gamma.", place: { start: 5, end: 11 } }),
		).toBe("#:~:text=beta");
	});

	it("names a short passage across two blocks by its part in each block", () => {
		expect(fragmentOf({ pageText: "Intro.\nEnd of one\nStart of two\nOutro.", passage: "End of one\nStart of two" })).toBe(
			"#:~:text=End%20of%20one,Start%20of%20two",
		);
	});

	it("names a long passage across two blocks by six words from its first block and six from its last", () => {
		const first = "a1 a2 a3 a4 a5 a6 a7 a8";
		const last = "b1 b2 b3 b4 b5 b6 b7 b8";
		expect(fragmentOf({ pageText: `${first}\nmiddle words\n${last}`, passage: `${first}\nmiddle words\n${last}` })).toBe(
			"#:~:text=a1%20a2%20a3%20a4%20a5%20a6,b3%20b4%20b5%20b6%20b7%20b8",
		);
	});

	it("adds words around a quote that also appears earlier in another case", () => {
		expect(
			fragmentOf({
				pageText: "The Answer is here.\nWe know the answer is not there at all.",
				passage: "the answer is",
			}),
		).toBe("#:~:text=We%20know-,the%20answer%20is,-not%20there%20at");
	});

	it("adds context to the first and last terms of a long quote that also appears earlier", () => {
		const passage = "one two three four five six seven eight nine ten eleven twelve thirteen";
		expect(fragmentOf({ pageText: `${passage}.\nSo said: ${passage} today.`, passage, occurrence: 1 })).toBe(
			"#:~:text=So%20said%3A-,one%20two%20three%20four%20five%20six,eight%20nine%20ten%20eleven%20twelve%20thirteen,-today.",
		);
	});

	it("leaves the fragment out when the words around the quote repeat too", () => {
		expect(
			fragmentOf({ pageText: "We said yes then.\nWe said yes then.", passage: "said yes", occurrence: 1 }),
		).toBe(undefined);
	});

	it("leaves the fragment out when a repeated quote has no whole words beside it", () => {
		expect(fragmentOf({ pageText: "alpha beta\nxbeta", passage: "beta", occurrence: 1 })).toBe(undefined);
	});

	it("leaves the fragment out when a repeated quote fills its block", () => {
		expect(fragmentOf({ pageText: "Same line\nSame line", passage: "Same line", occurrence: 1 })).toBe(undefined);
	});

	it("matches an accented letter by its base letter, as a browser does", () => {
		expect(
			fragmentOf({ pageText: "Cafe owners.\nThe café opens.", passage: "café opens", occurrence: 0 }),
		).toBe("#:~:text=caf%C3%A9%20opens");
		expect(fragmentOf({ pageText: "A cafe opens.\nThe café opens late.", passage: "café opens" })).toBe(
			"#:~:text=The-,caf%C3%A9%20opens,-late.",
		);
	});

	it("takes the words after a repeated quote from its own block only", () => {
		expect(
			fragmentOf({ pageText: "Go now please.\nWe go now or never.\nNext block.", passage: "go now" }),
		).toBe("#:~:text=We-,go%20now,-or%20never.");
	});
});
