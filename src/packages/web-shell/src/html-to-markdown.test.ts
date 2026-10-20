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

	it("keeps the list items of a table cell as a markdown list", () => {
		const html = `
			<table>
				<tr><th>2.0</th><th>2026-03-31</th></tr>
				<tr><td colspan="2"><ul><li>Added <b>dark mode</b>.</li><li>Fixed a crash on start.</li></ul></td></tr>
				<tr><th>1.0</th><th>2026-01-15</th></tr>
				<tr><td colspan="2"><ul><li>First release.</li></ul></td></tr>
			</table>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toBe(
			[
				"2.0",
				"2026-03-31",
				"* Added **dark mode**.\n* Fixed a crash on start.",
				"1.0",
				"2026-01-15",
				"* First release.",
			].join("\n\n"),
		);
	});

	it("does not pad table cells to the widest cell in their column", () => {
		const html = `
			<table>
				<tr><th>Plan</th><th>Price</th></tr>
				<tr><td>Readplace</td><td>$49/yr</td></tr>
				<tr><td>A plan with a much longer name than the rest</td><td>$9.99</td></tr>
			</table>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toBe(
			[
				"| Plan | Price |",
				"| --- | --- |",
				"| Readplace | $49/yr |",
				"| A plan with a much longer name than the rest | $9.99 |",
			].join("\n"),
		);
	});

	it("keeps a line break inside a table cell instead of joining the words around it", () => {
		const html = `
			<table>
				<tr><th>Property</th><th>Expected type</th></tr>
				<tr><td>author</td><td><a href="/Person">Person</a> or<br><a href="/Organization">Organization</a></td></tr>
			</table>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toContain(
			"| author | [Person](/Person) or<br>[Organization](/Organization) |",
		);
	});

	it("writes a comment thread laid out with nested tables as text in reading order", () => {
		const html = `
			<table>
				<tr><td><table><tr><td><img src="https://example.com/s.gif" width="0"></td><td><div>First comment.<p>Second paragraph.</p></div></td></tr></table></td></tr>
				<tr><td><table><tr><td><img src="https://example.com/s.gif" width="40"></td><td><div>A reply.</div></td></tr></table></td></tr>
			</table>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toBe(
			[
				"![](https://example.com/s.gif)",
				"First comment.",
				"Second paragraph.",
				"![](https://example.com/s.gif)",
				"A reply.",
			].join("\n\n"),
		);
	});

	it("writes inline code that holds a marker and a paragraph as one code span on one line", () => {
		const html = `<p><code><span>+</span><p><span>const</span> <span>total</span> = 2;</p></code></p>`;

		const md = htmlToMarkdown(html);

		expect(md).toBe("`+ const total = 2;`");
	});

	it("keeps the lines and indentation of code inside a pre that holds more than the code", () => {
		const html = "<pre>\n<code>if (ready) {\n  start();\n}</code></pre>";

		const md = htmlToMarkdown(html);

		expect(md).toBe("`if (ready) {\n  start();\n}`");
	});

	it("writes a diff laid out as a table with one GFM row per diff line", () => {
		const html = `
			<table>
				<tr><td colspan="4"><p><code><p>@@ -7,3 +7,3 @@</p></code></p></td></tr>
				<tr><td><code>7</code></td><td><code>7</code></td><td><code><p><span>assert</span><span>.</span><span>ok</span><span>(</span><span>actual</span><span>)</span><span>;</span></p></code></td></tr>
				<tr><td><code>8</code></td><td><code></code></td><td><code><span>-</span><p><span>const</span> <span>total</span> = 1;</p></code></td></tr>
				<tr><td><code></code></td><td><code>8</code></td><td><code><span>+</span><p><span>const</span> <span>total</span> = 2;</p></code></td></tr>
			</table>
		`;

		const md = htmlToMarkdown(html);

		expect(md).toBe(
			[
				"| `@@ -7,3 +7,3 @@` |  |  |",
				"| --- | --- | --- |",
				"| `7` | `7` | `assert.ok(actual);` |",
				"| `8` |  | `- const total = 1;` |",
				"|  | `8` | `+ const total = 2;` |",
			].join("\n"),
		);
	});
});
