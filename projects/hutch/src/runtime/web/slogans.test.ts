import { CANONICAL_SLOGAN, MAX_SLOGAN_LENGTH, SLOGANS } from "./slogans";

describe("SLOGANS", () => {
	it("leads with the slogan the homepage title and structured data already claim", () => {
		expect(CANONICAL_SLOGAN).toBe("Your #1 AI-Powered Reading List.");
		expect(SLOGANS[0]).toBe(CANONICAL_SLOGAN);
	});

	it("offers more than one slogan so every surface has something to rotate through", () => {
		expect(SLOGANS.length).toBeGreaterThan(1);
	});

	it("never repeats a slogan, which would stall the rotation on a duplicate", () => {
		expect(new Set(SLOGANS).size).toBe(SLOGANS.length);
	});

	it("keeps every slogan within the one line the iOS login screen renders", () => {
		for (const slogan of SLOGANS) {
			expect(slogan.length).toBeLessThanOrEqual(MAX_SLOGAN_LENGTH);
		}
	});

	it("carries no leading or trailing whitespace, which a client would render verbatim", () => {
		for (const slogan of SLOGANS) {
			expect(slogan).toBe(slogan.trim());
			expect(slogan.length).toBeGreaterThan(0);
		}
	});
});
