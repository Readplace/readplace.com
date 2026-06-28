import { readCookie } from "./cookie";

describe("readCookie", () => {
	it("reads a single cookie value", () => {
		expect(readCookie("hutch_sid=abc123", "hutch_sid")).toBe("abc123");
	});

	it("returns undefined when the header is absent", () => {
		expect(readCookie(undefined, "hutch_sid")).toBeUndefined();
	});

	it("finds the named cookie among several", () => {
		expect(readCookie("session=abc; hutch_sid=abc123; theme=dark", "hutch_sid")).toBe("abc123");
	});

	it("returns undefined when the named cookie is not present", () => {
		expect(readCookie("session=abc; theme=dark", "hutch_sid")).toBeUndefined();
	});

	it("decodes percent-encoded values", () => {
		expect(readCookie("k=a%20b", "k")).toBe("a b");
	});

	it("returns the raw value rather than throwing when it is not a valid percent-escape", () => {
		expect(readCookie("k=%", "k")).toBe("%");
	});
});
