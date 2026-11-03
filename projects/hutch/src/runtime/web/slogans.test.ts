import { CANONICAL_SLOGAN, MAX_SLOGAN_LENGTH, SLOGANS } from "./slogans";

describe("SLOGANS", () => {
	it("leads with the warm slogan the OG image alt already carries", () => {
		expect(CANONICAL_SLOGAN).toBe("A warm, dependable place for your reading list.");
		expect(SLOGANS[0]).toBe(CANONICAL_SLOGAN);
	});

	it("rotates through the rest in the order they were written, without the ranking claim", () => {
		expect(SLOGANS).toEqual([
			"A warm, dependable place for your reading list.",
			"Paste a link. Read it clean.",
			"Your reading list, without the noise.",
			"Your reading universe. Here.",
			"Read what matters",
			"It just works. - Matthew Motz",
		]);
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
