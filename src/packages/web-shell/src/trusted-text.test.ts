import { type HtmlText, type PlainText, htmlText, plainText } from "./trusted-text";

function acceptsPlain(value: PlainText): string {
	return value;
}

function acceptsHtml(value: HtmlText): string {
	return value;
}

describe("htmlText", () => {
	it("returns the markup it was given", () => {
		expect(acceptsHtml(htmlText("<code>a</code>"))).toBe("<code>a</code>");
	});

	it("is rejected where plain text is required", () => {
		// @ts-expect-error
		expect(acceptsPlain(htmlText("<b>a</b>"))).toBe("<b>a</b>");
	});
});

describe("plainText", () => {
	it("returns the text it was given", () => {
		expect(acceptsPlain(plainText("a < b"))).toBe("a < b");
	});

	it("is rejected where markup is required", () => {
		// @ts-expect-error
		expect(acceptsHtml(plainText("a"))).toBe("a");
	});
});

describe("a bare string", () => {
	it("is rejected by both", () => {
		// @ts-expect-error
		expect(acceptsPlain("a")).toBe("a");
		// @ts-expect-error
		expect(acceptsHtml("a")).toBe("a");
	});
});
