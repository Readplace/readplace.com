import { READLIST_FIT_PROMPT } from "./readlist-fit-prompt";

describe("READLIST_FIT_PROMPT", () => {
	it("names all three verdicts", () => {
		for (const verdict of ['"keep"', '"drop"', '"unsure"']) expect(READLIST_FIT_PROMPT).toContain(verdict);
	});

	it("carries the reason limit and the example cap", () => {
		expect(READLIST_FIT_PROMPT).toContain("at most 120 characters");
		expect(READLIST_FIT_PROMPT).toContain("up to 20 of the reader's earlier calls");
	});

	it("names the five slots", () => {
		for (const slot of ['"keep"', '"skip"', '"examples"', '"email"', '"candidates"']) {
			expect(READLIST_FIT_PROMPT).toContain(slot);
		}
	});

	it("asks for json in lowercase, which DeepSeek's JSON output requires", () => {
		expect(READLIST_FIT_PROMPT).toContain("json object");
	});

	it("never tells the model to keep a link when it is uncertain", () => {
		expect(READLIST_FIT_PROMPT.toLowerCase()).not.toMatch(/uncertain[^.]*keep it/);
		expect(READLIST_FIT_PROMPT).toContain("prefer unsure to a guess");
	});
});
