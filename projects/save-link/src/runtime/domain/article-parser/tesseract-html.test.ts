import {
	extractTesseractParagraphs,
	joinParagraphsAsText,
	rewrapAsTesseractHtml,
} from "./tesseract-html";

describe("extractTesseractParagraphs", () => {
	it("extracts text from a single paragraph", () => {
		const html = '<p class="ocr-tesseract">Hello world.</p>';
		expect(extractTesseractParagraphs(html)).toEqual(["Hello world."]);
	});

	it("extracts text from multiple paragraphs in order", () => {
		const html = '<p class="ocr-tesseract">First.</p><p class="ocr-tesseract">Second.</p><p class="ocr-tesseract">Third.</p>';
		expect(extractTesseractParagraphs(html)).toEqual(["First.", "Second.", "Third."]);
	});

	it("decodes the five basic HTML entities", () => {
		const html = '<p class="ocr-tesseract">5 &lt; 10 &amp; 10 &gt; 3, said &quot;Alice&#39;s&quot; friend.</p>';
		expect(extractTesseractParagraphs(html)).toEqual([
			'5 < 10 & 10 > 3, said "Alice\'s" friend.',
		]);
	});

	it("decodes &amp; last so &amp;lt; stays as the literal &lt;", () => {
		const html = '<p class="ocr-tesseract">double-encoded: &amp;lt;not-a-tag&amp;gt;</p>';
		expect(extractTesseractParagraphs(html)).toEqual(["double-encoded: &lt;not-a-tag&gt;"]);
	});

	it("returns an empty array for empty input", () => {
		expect(extractTesseractParagraphs("")).toEqual([]);
	});

	it("returns an empty array when no Tesseract paragraphs are present", () => {
		expect(extractTesseractParagraphs("<div>no ocr here</div>")).toEqual([]);
	});

	it("ignores non-ocr-tesseract paragraphs", () => {
		// Mixed shape: a failed-page placeholder uses class="ocr-failed". The
		// extractor must only pull the ocr-tesseract paragraphs since the
		// failed-page placeholder is not part of the cleanup-eligible text.
		const html = '<p class="ocr-tesseract">real text</p><p class="ocr-failed">[Page 4: OCR unavailable]</p>';
		expect(extractTesseractParagraphs(html)).toEqual(["real text"]);
	});

	it("survives single-quoted class attributes (different markup styles)", () => {
		const html = `<p class='ocr-tesseract'>quoted with apostrophe</p>`;
		expect(extractTesseractParagraphs(html)).toEqual(["quoted with apostrophe"]);
	});

	it("bails on a malformed final paragraph without throwing", () => {
		// A truncated chunk could end with an unterminated <p>; the parser
		// silently drops the trailing fragment rather than throwing so the
		// orchestrator can carry on with whatever paragraphs it did get.
		const html = '<p class="ocr-tesseract">complete</p><p class="ocr-tesseract">truncated';
		expect(extractTesseractParagraphs(html)).toEqual(["complete"]);
	});
});

describe("joinParagraphsAsText", () => {
	it("joins paragraphs with a blank-line separator", () => {
		expect(joinParagraphsAsText(["one", "two", "three"])).toBe("one\n\ntwo\n\nthree");
	});

	it("returns the single paragraph unchanged", () => {
		expect(joinParagraphsAsText(["only"])).toBe("only");
	});

	it("returns the empty string for an empty input", () => {
		expect(joinParagraphsAsText([])).toBe("");
	});
});

describe("rewrapAsTesseractHtml", () => {
	it("wraps a single paragraph", () => {
		expect(rewrapAsTesseractHtml("Hello world.")).toBe(
			'<p class="ocr-tesseract">Hello world.</p>',
		);
	});

	it("wraps multiple paragraphs split on blank lines", () => {
		expect(rewrapAsTesseractHtml("First.\n\nSecond.\n\nThird.")).toBe(
			'<p class="ocr-tesseract">First.</p><p class="ocr-tesseract">Second.</p><p class="ocr-tesseract">Third.</p>',
		);
	});

	it("re-escapes the five basic HTML entities so the wrapped output is safe", () => {
		expect(rewrapAsTesseractHtml('5 < 10 & "Alice\'s"')).toBe(
			'<p class="ocr-tesseract">5 &lt; 10 &amp; &quot;Alice&#39;s&quot;</p>',
		);
	});

	it("returns the empty string for empty input", () => {
		expect(rewrapAsTesseractHtml("")).toBe("");
	});

	it("returns the empty string for whitespace-only input", () => {
		expect(rewrapAsTesseractHtml("   \n  \n  ")).toBe("");
	});

	it("trims paragraph-internal whitespace at edges", () => {
		expect(rewrapAsTesseractHtml("  spaced  \n\n  also spaced  ")).toBe(
			'<p class="ocr-tesseract">spaced</p><p class="ocr-tesseract">also spaced</p>',
		);
	});

	it("collapses paragraphs separated by more than two newlines", () => {
		expect(rewrapAsTesseractHtml("a\n\n\n\nb")).toBe(
			'<p class="ocr-tesseract">a</p><p class="ocr-tesseract">b</p>',
		);
	});

	it("round-trips with extractTesseractParagraphs (no content loss for simple text)", () => {
		const original = "alpha beta\n\ngamma delta\n\nepsilon";
		const html = rewrapAsTesseractHtml(original);
		const paragraphs = extractTesseractParagraphs(html);
		expect(joinParagraphsAsText(paragraphs)).toBe(original);
	});
});
