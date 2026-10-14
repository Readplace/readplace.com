import { initialsFor } from "./user-initials";

function fromEmail(email: string): string {
	return initialsFor({ email, displayName: undefined });
}

function fromName(displayName: string): string {
	return initialsFor({ email: "reader@example.com", displayName });
}

describe("initialsFor an account with no display name", () => {
	it("takes one letter from each of the first two dotted segments of the local part", () => {
		expect(fromEmail("james.davis@example.com")).toBe("JD");
	});

	it("treats underscores, hyphens and plus tags as segment boundaries", () => {
		expect(fromEmail("ana_lu@example.com")).toBe("AL");
		expect(fromEmail("ana-lu@example.com")).toBe("AL");
		expect(fromEmail("ana+news@example.com")).toBe("AN");
	});

	it("falls back to the first two letters of a single-segment local part", () => {
		expect(fromEmail("admin@example.com")).toBe("AD");
	});

	it("falls back to the whole local part when it is a single character", () => {
		expect(fromEmail("j@example.com")).toBe("J");
	});

	it("ignores an empty segment left by a leading separator", () => {
		expect(fromEmail(".james.davis@example.com")).toBe("JD");
	});

	it("rejects a value with no local part", () => {
		expect(() => fromEmail("@example.com")).toThrow(/local part/);
	});
});

describe("initialsFor an account with a display name", () => {
	it("takes the first letter of the first and the last word, whatever the email says", () => {
		expect(fromName("James Davis")).toBe("JD");
	});

	it("skips the middle words of a longer name", () => {
		expect(fromName("Mary Jane Watson")).toBe("MW");
	});

	it("takes two letters of a one-word name, so the disc never drops to one letter", () => {
		expect(fromName("Madonna")).toBe("MA");
	});

	it("reads repeated inner spaces as one boundary", () => {
		expect(fromName("James   Davis")).toBe("JD");
	});

	it("uppercases an accented first letter", () => {
		expect(fromName("élodie durand")).toBe("ÉD");
	});

	it("keeps an astral first character whole rather than splitting it into a lone surrogate", () => {
		expect(Array.from(fromName("𝒥ane Doe"))).toEqual(["𝒥", "D"]);
		expect(Array.from(fromName("𝒥ane"))).toEqual(["𝒥", "A"]);
	});

	it("rejects a name with no word in it", () => {
		expect(() => fromName(" ")).toThrow(/carries a word/);
	});
});
