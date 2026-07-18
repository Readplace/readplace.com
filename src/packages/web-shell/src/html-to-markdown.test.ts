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
					<tr><td>Readplace</td><td>$49/yr</td></tr>
					<tr><td>Readwise</td><td>$9.99</td></tr>
				</tbody>
			</table>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toMatch(/\|\s+Name\s+\|\s+Price\s+\|/);
		expect(md).toMatch(/\|\s+-+\s+\|\s+-+\s+\|/);
		expect(md).toContain("Readplace");
		expect(md).toContain("$49/yr");
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

	it("drops ignored elements nested inside a link", () => {
		const html = `
			<a href="/install?client=chrome"><svg><title>Chrome logo</title><path d="M12 0"/></svg>Chrome</a>
			<a href="/x"><template>Shadow</template>Plain</a>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toContain("[Chrome](/install?client=chrome)");
		expect(md).toContain("[Plain](/x)");
		expect(md).not.toContain("Chrome logo");
		expect(md).not.toContain("Shadow");
	});

	it("drops ignored elements nested inside table cells and headers", () => {
		const html = `
			<table>
				<thead><tr><th><svg><title>Icon</title></svg>Name</th></tr></thead>
				<tbody><tr><td><svg><desc>Round</desc></svg>Readplace</td></tr></tbody>
			</table>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toContain("Name");
		expect(md).toContain("Readplace");
		expect(md).not.toContain("Icon");
		expect(md).not.toContain("Round");
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
