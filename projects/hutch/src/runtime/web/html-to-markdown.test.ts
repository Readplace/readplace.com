import { htmlToMarkdown } from "./html-to-markdown";

describe("htmlToMarkdown", () => {
	it("converts headings, paragraphs, and inline links to markdown", () => {
		const html = `<h1>Hello</h1><p>World <a href="https://example.com">link</a>.</p>`;

		const md = htmlToMarkdown(html);

		expect(md).toContain("# Hello");
		expect(md).toContain("World [link](https://example.com).");
	});

	it("converts tables to GFM table syntax", () => {
		const html = `
			<table>
				<thead><tr><th>Name</th><th>Price</th></tr></thead>
				<tbody>
					<tr><td>Readplace</td><td>$3.99</td></tr>
					<tr><td>Readwise</td><td>$9.99</td></tr>
				</tbody>
			</table>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toMatch(/\|\s+Name\s+\|\s+Price\s+\|/);
		expect(md).toMatch(/\|\s+-+\s+\|\s+-+\s+\|/);
		expect(md).toContain("Readplace");
		expect(md).toContain("$3.99");
	});

	it("drops <script> blocks (including JSON-LD) entirely", () => {
		const html = `
			<p>Visible.</p>
			<script type="application/ld+json">{"@type":"WebSite"}</script>
			<script>console.log('hi')</script>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toContain("Visible.");
		expect(md).not.toContain("WebSite");
		expect(md).not.toContain("console.log");
	});

	it("drops <style> and <noscript> blocks", () => {
		const html = `
			<style>.a { color: red; }</style>
			<noscript>Enable JS</noscript>
			<p>Body.</p>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toContain("Body.");
		expect(md).not.toContain("color: red");
		expect(md).not.toContain("Enable JS");
	});

	it("does not retain htmx or data-test attributes from container elements", () => {
		const html = `
			<form hx-boost="true" hx-target="main" data-test-form="save">
				<button data-test-cta="save">Save</button>
			</form>
		`;

		const md = htmlToMarkdown(html);

		expect(md).not.toContain("hx-boost");
		expect(md).not.toContain("hx-target");
		expect(md).not.toContain("data-test-");
		expect(md).toContain("Save");
	});
});
