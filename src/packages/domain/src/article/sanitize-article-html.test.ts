import { sanitizeArticleHtml } from "./sanitize-article-html";

describe("sanitizeArticleHtml", () => {
	it("keeps the prose, headings, lists and figures an article body is made of", () => {
		const article =
			'<h2>Heading</h2><p>Body copy with <strong>emphasis</strong> and a <a href="https://example.com/other">link</a>.</p><ul><li>One</li></ul><figure><img src="https://cdn.example.com/hero.jpg" alt="Hero" /><figcaption>Caption</figcaption></figure>';

		expect(sanitizeArticleHtml(article)).toBe(article);
	});

	it("keeps table structure so a wide data table still renders as a grid", () => {
		const table =
			'<table><caption>Cap</caption><thead><tr><th colspan="2">Head</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td></tr></tbody></table>';

		expect(sanitizeArticleHtml(table)).toBe(table);
	});

	it("removes a captured stylesheet and its contents so article CSS cannot repaint the page around it", () => {
		const withStyleTag =
			"<style>body { position: fixed; inset: 0; background: red; }</style><p>Body copy.</p>";

		expect(sanitizeArticleHtml(withStyleTag)).toBe("<p>Body copy.</p>");
	});

	it("removes inline style attributes so captured markup cannot overlay the page chrome", () => {
		const pinned =
			'<p style="position: fixed; inset: 0; z-index: 99999;">Body copy.</p>';

		expect(sanitizeArticleHtml(pinned)).toBe("<p>Body copy.</p>");
	});

	it("removes event-handler attributes", () => {
		const handler = '<p onclick="steal()" onmouseover="steal()">Body copy.</p>';

		expect(sanitizeArticleHtml(handler)).toBe("<p>Body copy.</p>");
	});

	it("removes a script tag and its contents", () => {
		const withScript = '<p>Body copy.</p><script>fetch("/queue")</script>';

		expect(sanitizeArticleHtml(withScript)).toBe("<p>Body copy.</p>");
	});

	it("removes an svg subtree, which the parser never sanitises and can carry scripting", () => {
		const withSvg =
			'<p>Body copy.</p><svg><script>fetch("/queue")</script></svg>';

		expect(sanitizeArticleHtml(withSvg)).toBe("<p>Body copy.</p>");
	});

	it("removes an embedded iframe and its contents", () => {
		const withIframe =
			'<p>Body copy.</p><iframe src="https://evil.example.com/x"></iframe>';

		expect(sanitizeArticleHtml(withIframe)).toBe("<p>Body copy.</p>");
	});

	it("drops a javascript: href but keeps the link text", () => {
		const scriptLink = '<a href="javascript:steal()">Click</a>';

		expect(sanitizeArticleHtml(scriptLink)).toBe("<a>Click</a>");
	});

	it("drops a javascript: image source", () => {
		const scriptImage = '<img src="javascript:steal()" alt="x" />';

		expect(sanitizeArticleHtml(scriptImage)).toBe('<img alt="x" />');
	});

	it("keeps target and rel on links, which the same-host retarget and the video facade both write", () => {
		const facadeLink =
			'<a href="https://www.youtube.com/watch?v=1" target="_blank" rel="noopener noreferrer">Watch</a>';

		expect(sanitizeArticleHtml(facadeLink)).toBe(facadeLink);
	});

	it("keeps responsive image attributes so a rehosted poster still picks a source", () => {
		const responsiveImage =
			'<img src="https://cdn.example.com/a.jpg" srcset="https://cdn.example.com/a2.jpg 2x" sizes="100vw" alt="A" width="640" height="480" loading="lazy" />';

		expect(sanitizeArticleHtml(responsiveImage)).toBe(responsiveImage);
	});

	it("unwraps a picture element so its image still renders", () => {
		const picture =
			'<picture><source srcset="https://cdn.example.com/a.webp" /><img src="https://cdn.example.com/a.jpg" alt="A" /></picture>';

		expect(sanitizeArticleHtml(picture)).toBe(
			'<img src="https://cdn.example.com/a.jpg" alt="A" />',
		);
	});

	it("keeps the classes the parser styles its video placeholder and OCR markers with", () => {
		const parserMarkup =
			'<p class="reader-video-placeholder">Watch this video on <a href="https://vimeo.com/1">vimeo.com</a> →</p><p class="reader-embed-facade"><a href="https://www.youtube.com/watch?v=1"><img src="https://cdn.example.com/p.jpg" alt="Watch on YouTube" loading="lazy" /></a></p><p class="ocr-failed">[Page 2: OCR unavailable]</p><hr class="ocr-page-break" />';

		expect(sanitizeArticleHtml(parserMarkup)).toBe(parserMarkup);
	});

	it("drops a class the reader does not style, so captured markup cannot borrow app styling", () => {
		const borrowed = '<p class="nav__link">Body copy.</p>';

		expect(sanitizeArticleHtml(borrowed)).toBe("<p>Body copy.</p>");
	});

	it("drops id attributes so captured markup cannot clobber the swap targets around it", () => {
		const clobbering = '<div id="article-body-reader-slot">Body copy.</div>';

		expect(sanitizeArticleHtml(clobbering)).toBe("<div>Body copy.</div>");
	});
});
