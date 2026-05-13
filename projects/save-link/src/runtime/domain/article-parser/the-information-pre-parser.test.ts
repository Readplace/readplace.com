import { theInformationPreParser } from "./the-information-pre-parser";

function buildHtml(scriptContent: string | null, extraBody = "") {
	const scriptTag =
		scriptContent === null
			? ""
			: `<script type="application/json" data-component-name="Article">${scriptContent}</script>`;
	return `<html><head><title>Page</title></head><body>
		<nav><ul>${"<li><a href=\"/x\">link</a></li>".repeat(50)}</ul></nav>
		${extraBody}
		${scriptTag}
	</body></html>`;
}

describe("theInformationPreParser.matches", () => {
	it("matches the www subdomain", () => {
		expect(theInformationPreParser.matches({ hostname: "www.theinformation.com" })).toBe(true);
	});

	it("matches the apex hostname", () => {
		expect(theInformationPreParser.matches({ hostname: "theinformation.com" })).toBe(true);
	});

	it("does not match other hostnames", () => {
		expect(theInformationPreParser.matches({ hostname: "example.com" })).toBe(false);
	});
});

describe("theInformationPreParser.extract", () => {
	it("returns title and bodyHtml containing caption, freeBlurb and paywall notice", () => {
		const html = buildHtml(
			JSON.stringify({
				article: {
					title: "Test Headline",
					freeBlurb: "<p>Lead paragraph of the public preview.</p><p>Second paragraph.</p>",
					pictureCaption: "Photo by Test Photographer.",
				},
			}),
		);

		const result = theInformationPreParser.extract({ html });

		expect(result?.title).toBe("Test Headline");
		expect(result?.bodyHtml).toContain("Photo by Test Photographer.");
		expect(result?.bodyHtml).toContain("Lead paragraph of the public preview.");
		expect(result?.bodyHtml).toContain("Second paragraph.");
		expect(result?.bodyHtml).toContain(
			"This is the publicly available preview from The Information",
		);
		expect(result?.bodyHtml).toContain(
			"Try to open the full article using a browser extension",
		);
	});

	it("omits title when absent in the JSON", () => {
		const html = buildHtml(
			JSON.stringify({ article: { freeBlurb: "<p>Just the lead paragraph here.</p>" } }),
		);

		const result = theInformationPreParser.extract({ html });

		expect(result?.title).toBeUndefined();
		expect(result?.bodyHtml).toContain("Just the lead paragraph here.");
	});

	it("omits caption paragraph when the field is absent", () => {
		const html = buildHtml(
			JSON.stringify({ article: { title: "Has title", freeBlurb: "<p>Lead.</p>" } }),
		);

		const result = theInformationPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("Photo by");
		expect(result?.bodyHtml).toContain("Lead.");
	});

	it("escapes the picture caption as text (not HTML)", () => {
		const html = buildHtml(
			JSON.stringify({
				article: {
					freeBlurb: "<p>Lead.</p>",
					pictureCaption: "Caption with <tag> and & ampersand inside.",
				},
			}),
		);

		const result = theInformationPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("<tag>");
		expect(result?.bodyHtml).toContain("&lt;tag&gt;");
		expect(result?.bodyHtml).toContain("&amp; ampersand");
	});

	it("returns undefined when the Article script tag is absent", () => {
		const html = buildHtml(null);

		const result = theInformationPreParser.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when the script tag is empty", () => {
		const html = buildHtml("");

		const result = theInformationPreParser.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when the JSON is malformed", () => {
		const html = buildHtml("{not-valid-json}");

		const result = theInformationPreParser.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when JSON shape does not match the schema", () => {
		const html = buildHtml(JSON.stringify({ article: { freeBlurb: 12345 } }));

		const result = theInformationPreParser.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when the article object is absent from the JSON", () => {
		const html = buildHtml(JSON.stringify({ unrelated: "data" }));

		const result = theInformationPreParser.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when the article object lacks freeBlurb", () => {
		const html = buildHtml(JSON.stringify({ article: { title: "Has title but no blurb" } }));

		const result = theInformationPreParser.extract({ html });

		expect(result).toBeUndefined();
	});
});
