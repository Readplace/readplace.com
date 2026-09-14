import { PAST_READS_PROMPT } from "./related-past-reads-prompt";

describe("PAST_READS_PROMPT", () => {
	it("substitutes the result and reason caps into the loaded prompt", () => {
		expect(PAST_READS_PROMPT).toContain("Pick at most 3 past reads");
		expect(PAST_READS_PROMPT).toContain("at most 120 characters");
	});

	it("instructs a past-reads-only selection over the same specific subject", () => {
		expect(PAST_READS_PROMPT).toContain("PAST READS");
		expect(PAST_READS_PROMPT).toContain("same specific subject");
	});
});
