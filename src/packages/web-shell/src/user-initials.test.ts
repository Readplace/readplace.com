import { initialsFromEmail } from "./user-initials";

describe("initialsFromEmail", () => {
	it("takes one letter from each of the first two dotted segments of the local part", () => {
		expect(initialsFromEmail("james.davis@example.com")).toBe("JD");
	});

	it("treats underscores, hyphens and plus tags as segment boundaries", () => {
		expect(initialsFromEmail("ana_lu@example.com")).toBe("AL");
		expect(initialsFromEmail("ana-lu@example.com")).toBe("AL");
		expect(initialsFromEmail("ana+news@example.com")).toBe("AN");
	});

	it("falls back to the first two letters of a single-segment local part", () => {
		expect(initialsFromEmail("admin@example.com")).toBe("AD");
	});

	it("falls back to the whole local part when it is a single character", () => {
		expect(initialsFromEmail("j@example.com")).toBe("J");
	});

	it("ignores an empty segment left by a leading separator", () => {
		expect(initialsFromEmail(".james.davis@example.com")).toBe("JD");
	});

	it("rejects a value with no local part", () => {
		expect(() => initialsFromEmail("@example.com")).toThrow(/local part/);
	});
});
