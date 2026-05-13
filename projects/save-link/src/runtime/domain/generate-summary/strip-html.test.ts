import { stripHtml } from "./strip-html";

describe("stripHtml", () => {
	it("should extract text from HTML tags", () => {
		const result = stripHtml("<p>Hello <strong>world</strong></p>");
		expect(result).toBe("Hello world");
	});

	it("should collapse whitespace into single spaces", () => {
		const result = stripHtml("<p>Hello    \n\t  world</p>");
		expect(result).toBe("Hello world");
	});

	it("should return empty string for empty HTML", () => {
		const result = stripHtml("");
		expect(result).toBe("");
	});

	it("should handle nested elements", () => {
		const result = stripHtml("<div><p>First</p><p>Second</p></div>");
		expect(result).toBe("First Second");
	});

	it("should handle plain text without tags", () => {
		const result = stripHtml("Just plain text");
		expect(result).toBe("Just plain text");
	});

	it("should handle elements with null textContent in text nodes", () => {
		const result = stripHtml("<script></script><p>visible</p>");
		expect(result).toBe("visible");
	});
});
