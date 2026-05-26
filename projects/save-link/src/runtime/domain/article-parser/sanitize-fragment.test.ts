import { sanitizeFragment } from "./sanitize-fragment";

describe("sanitizeFragment", () => {
	it("preserves the semantic HTML5 elements an LLM-converted page would emit", () => {
		const html =
			'<h2>Section title</h2>' +
			'<p>Body prose here.</p>' +
			'<ul><li>one</li><li>two</li></ul>' +
			'<ol><li>first</li></ol>' +
			'<pre><code>console.log(1)</code></pre>' +
			'<blockquote>quoted</blockquote>' +
			'<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>' +
			'<strong>bold</strong>' +
			'<em>italic</em>';
		const out = sanitizeFragment(html);
		expect(out).toContain("<h2>Section title</h2>");
		expect(out).toContain("<p>Body prose here.</p>");
		expect(out).toContain("<ul><li>one</li><li>two</li></ul>");
		expect(out).toContain("<ol><li>first</li></ol>");
		expect(out).toContain("<pre><code>console.log(1)</code></pre>");
		expect(out).toContain("<blockquote>quoted</blockquote>");
		expect(out).toContain("<table>");
		expect(out).toContain("<strong>bold</strong>");
		expect(out).toContain("<em>italic</em>");
	});

	it("removes <script> elements entirely", () => {
		expect(sanitizeFragment('<p>safe</p><script>alert(1)</script>')).toBe('<p>safe</p>');
	});

	it("removes <iframe> elements entirely", () => {
		expect(sanitizeFragment('<p>safe</p><iframe src="x"></iframe>')).toBe('<p>safe</p>');
	});

	it("removes <style>, <object>, <embed>, <form>, <input>, <button>, <link>, <meta>", () => {
		const blocked = '<style>.x{}</style><object data="x"></object><embed src="x"><form></form><input><button>x</button><link rel="x"><meta charset="utf-8">';
		expect(sanitizeFragment(`<p>safe</p>${blocked}`)).toBe('<p>safe</p>');
	});

	it("strips disallowed attributes from <a> (only href survives)", () => {
		const out = sanitizeFragment('<a href="https://example.com" class="x" onclick="x()" target="_blank">link</a>');
		expect(out).toContain('href="https://example.com"');
		expect(out).not.toContain('class="x"');
		expect(out).not.toContain('onclick');
		expect(out).not.toContain('target');
	});

	it("strips javascript: hrefs", () => {
		expect(sanitizeFragment('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
	});

	it("strips data: hrefs (XSS via data URLs)", () => {
		expect(sanitizeFragment('<a href="data:text/html,<script>1</script>">x</a>')).not.toContain('data:');
	});

	it("strips data: src on <img>", () => {
		const out = sanitizeFragment('<img src="data:image/png;base64,abc" alt="x">');
		expect(out).not.toContain('data:');
		expect(out).toContain('alt="x"');
	});

	it("strips disallowed attributes from <img> while keeping src and alt", () => {
		const out = sanitizeFragment('<img src="https://e.com/a.png" alt="a" class="x" style="x">');
		expect(out).toContain('src="https://e.com/a.png"');
		expect(out).toContain('alt="a"');
		expect(out).not.toContain('class="x"');
		expect(out).not.toContain('style="x"');
	});

	it("preserves colspan/rowspan on <td>/<th> for tables", () => {
		const out = sanitizeFragment('<table><tr><th colspan="2" id="x">h</th></tr><tr><td rowspan="2" class="y">c</td></tr></table>');
		expect(out).toContain('colspan="2"');
		expect(out).toContain('rowspan="2"');
		expect(out).not.toContain('id="x"');
		expect(out).not.toContain('class="y"');
	});

	it("preserves class on <p> so the orchestrator's ocr-tesseract / ocr-failed markers survive", () => {
		const out = sanitizeFragment('<p class="ocr-tesseract">text</p><p class="ocr-failed">[Page 4: OCR unavailable]</p>');
		expect(out).toContain('<p class="ocr-tesseract">text</p>');
		expect(out).toContain('<p class="ocr-failed">[Page 4: OCR unavailable]</p>');
	});

	it("preserves class on <hr> so the orchestrator's ocr-page-break marker survives", () => {
		const out = sanitizeFragment('<p>page-0</p><hr class="ocr-page-break"><p>page-1</p>');
		expect(out).toContain('<hr class="ocr-page-break">');
	});

	it("strips other attributes from <hr> while keeping class", () => {
		const out = sanitizeFragment('<hr class="ocr-page-break" id="x" style="border:red">');
		expect(out).toContain('class="ocr-page-break"');
		expect(out).not.toContain('id="x"');
		expect(out).not.toContain('style="border:red"');
	});

	it("returns the empty string for empty input", () => {
		expect(sanitizeFragment("")).toBe("");
	});

	it("leaves elements without any attributes untouched", () => {
		expect(sanitizeFragment('<p>plain</p>')).toBe('<p>plain</p>');
	});
});
