import { theInformationSiteRules } from "./the-information-site-rules";

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

describe("theInformationSiteRules.matches", () => {
	it("matches the www subdomain", () => {
		expect(theInformationSiteRules.matches({ url: "https://www.theinformation.com/articles/x", hostname: "www.theinformation.com" })).toBe(true);
	});

	it("matches the apex hostname", () => {
		expect(theInformationSiteRules.matches({ url: "https://theinformation.com/articles/x", hostname: "theinformation.com" })).toBe(true);
	});

	it("does not match other hostnames", () => {
		expect(theInformationSiteRules.matches({ url: "https://example.com/x", hostname: "example.com" })).toBe(false);
	});
});

describe("theInformationSiteRules.extract", () => {
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

		const result = theInformationSiteRules.extract({ html });

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

		const result = theInformationSiteRules.extract({ html });

		expect(result?.title).toBeUndefined();
		expect(result?.bodyHtml).toContain("Just the lead paragraph here.");
	});

	it("omits caption paragraph when the field is absent", () => {
		const html = buildHtml(
			JSON.stringify({ article: { title: "Has title", freeBlurb: "<p>Lead.</p>" } }),
		);

		const result = theInformationSiteRules.extract({ html });

		expect(result?.bodyHtml?.startsWith("<p>Lead.</p>")).toBe(true);
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

		const result = theInformationSiteRules.extract({ html });

		expect(result?.bodyHtml).toContain("<p>Caption with &lt;tag&gt; and &amp; ampersand inside.</p>");
	});

	it("returns undefined when the Article script tag is absent", () => {
		const html = buildHtml(null);

		const result = theInformationSiteRules.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when the script tag is empty", () => {
		const html = buildHtml("");

		const result = theInformationSiteRules.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when the JSON is malformed", () => {
		const html = buildHtml("{not-valid-json}");

		const result = theInformationSiteRules.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when JSON shape does not match the schema", () => {
		const html = buildHtml(JSON.stringify({ article: { freeBlurb: 12345 } }));

		const result = theInformationSiteRules.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when the article object is absent from the JSON", () => {
		const html = buildHtml(JSON.stringify({ unrelated: "data" }));

		const result = theInformationSiteRules.extract({ html });

		expect(result).toBeUndefined();
	});

	it("returns undefined when the article object lacks freeBlurb", () => {
		const html = buildHtml(JSON.stringify({ article: { title: "Has title but no blurb" } }));

		const result = theInformationSiteRules.extract({ html });

		expect(result).toBeUndefined();
	});
});
