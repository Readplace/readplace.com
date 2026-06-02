import { extractPreviewHtml } from "./extract-preview-html";

describe("extractPreviewHtml", () => {
	it("returns title plus first paragraph for a simple article", () => {
		const html = `
			<html>
				<head><title>Hello World</title></head>
				<body>
					<p>First paragraph body.</p>
					<p>Second paragraph body.</p>
				</body>
			</html>
		`;
		expect(extractPreviewHtml(html)).toBe(
			"<h1>Hello World</h1><p>First paragraph body.</p><p>Second paragraph body.</p>",
		);
	});

	it("prefers og:title over the document <title>", () => {
		const html = `
			<html>
				<head>
					<title>Boring SEO Title</title>
					<meta property="og:title" content="Sharp Headline">
				</head>
				<body><p>Body text.</p></body>
			</html>
		`;
		expect(extractPreviewHtml(html)).toBe(
			"<h1>Sharp Headline</h1><p>Body text.</p>",
		);
	});

	it("caps at 3 paragraphs even when more are present", () => {
		const html = `
			<html>
				<head><title>T</title></head>
				<body>
					<p>One.</p>
					<p>Two.</p>
					<p>Three.</p>
					<p>Four.</p>
					<p>Five.</p>
				</body>
			</html>
		`;
		expect(extractPreviewHtml(html)).toBe(
			"<h1>T</h1><p>One.</p><p>Two.</p><p>Three.</p>",
		);
	});

	it("stops accumulating paragraphs after ~500 chars to keep the preview small", () => {
		const longParagraph = "Lorem ipsum dolor sit amet, ".repeat(20);
		const html = `
			<html>
				<head><title>T</title></head>
				<body>
					<p>${longParagraph}</p>
					<p>second paragraph after the cap.</p>
				</body>
			</html>
		`;
		expect(extractPreviewHtml(html)).toBe(
			`<h1>T</h1><p>${longParagraph.trim()}</p>`,
		);
	});

	it("skips empty paragraphs", () => {
		const html = `
			<html>
				<head><title>T</title></head>
				<body>
					<p></p>
					<p>   </p>
					<p>Real content.</p>
				</body>
			</html>
		`;
		expect(extractPreviewHtml(html)).toBe(
			"<h1>T</h1><p>Real content.</p>",
		);
	});

	it("escapes HTML special characters in title and paragraphs", () => {
		const html = `
			<html>
				<head><title>Title with &lt;tag&gt;</title></head>
				<body><p>Body &amp; more &#x3C;evil&#x3E;</p></body>
			</html>
		`;
		const result = extractPreviewHtml(html);
		expect(result).toContain("Title with &lt;tag&gt;");
		expect(result).toContain("Body &amp; more &lt;evil&gt;");
		expect(result).not.toMatch(/<tag>/);
		expect(result).not.toMatch(/<evil>/);
	});

	it("returns an empty string when there is no usable title and no paragraphs", () => {
		const html = "<html><head></head><body><div>nope</div></body></html>";
		expect(extractPreviewHtml(html)).toBe("");
	});

	it("emits just the title when there are no paragraphs", () => {
		const html = "<html><head><title>Only A Title</title></head><body></body></html>";
		expect(extractPreviewHtml(html)).toBe("<h1>Only A Title</h1>");
	});

	it("emits just paragraphs when there is no title", () => {
		const html = "<html><head></head><body><p>Just body.</p></body></html>";
		expect(extractPreviewHtml(html)).toBe("<p>Just body.</p>");
	});

	it("collapses whitespace inside a paragraph", () => {
		const html = "<html><head><title>T</title></head><body><p>Hello\n\n\tworld   spaced</p></body></html>";
		expect(extractPreviewHtml(html)).toBe("<h1>T</h1><p>Hello world spaced</p>");
	});
});
