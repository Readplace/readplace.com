import { ARTICLE_HIGHLIGHT_ID_PREFIX, chapterSectionId, isChapterSectionId, sanitizeArticleHtml } from "./sanitize-article-html";

describe("sanitizeArticleHtml", () => {
	it("keeps the prose, headings, lists and figures an article body is made of", () => {
		const article =
			'<h2>Heading</h2><p>Body copy with <strong>emphasis</strong> and a <a href="https://example.com/other">link</a>.</p><ul><li>One</li></ul><figure><img src="https://cdn.example.com/hero.jpg" alt="Hero" /><figcaption>Caption</figcaption></figure>';

		expect(sanitizeArticleHtml(article)).toBe(article);
	});

	it("keeps a table's structure and cell spans, which the reader lays out as a grid or as stacked rows", () => {
		const table =
			'<table><caption>Cap</caption><thead><tr><th colspan="2">Head</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td></tr></tbody></table>';

		expect(sanitizeArticleHtml(table)).toBe(table);
	});

	it("keeps the reader's table attributes on the elements the reader writes them to", () => {
		const described =
			'<table data-reader-fits="" data-reader-flow=""><tbody><tr data-reader-header=""><th data-label="h">h</th><td data-label="stage">x</td></tr></tbody></table>';

		expect(sanitizeArticleHtml(described)).toBe(
			'<table data-reader-fits data-reader-flow><tbody><tr data-reader-header><th data-label="h">h</th><td data-label="stage">x</td></tr></tbody></table>',
		);
	});

	it("drops every other data attribute, and the reader's attributes on elements the reader does not write them to", () => {
		const captured =
			'<table data-x="1"><tbody><tr data-y="1"><th data-z="1">h</th><td data-foo="1" data-label="v">v</td></tr></tbody></table><p data-label="p" data-reader-header="">p</p><div data-reader-fits="">d</div>';

		expect(sanitizeArticleHtml(captured)).toBe(
			'<table><tbody><tr><th>h</th><td data-label="v">v</td></tr></tbody></table><p>p</p><div>d</div>',
		);
	});

	it("escapes quotes and markup inside a cell label so a label cannot open an element", () => {
		const labelled =
			"<table><tbody><tr><td data-label='a \"b\" <i>'>x</td><th data-label='c &amp; <b>'>y</th></tr></tbody></table>";

		expect(sanitizeArticleHtml(labelled)).toBe(
			'<table><tbody><tr><td data-label="a &quot;b&quot; &lt;i&gt;">x</td><th data-label="c &amp; &lt;b&gt;">y</th></tr></tbody></table>',
		);
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

		expect(sanitizeArticleHtml(scriptLink)).toBe("<span>Click</span>");
	});

	it("demotes a link whose scheme it dropped, so the reader never serves an anchor with no href", () => {
		const ftpLink =
			'<p>See <a href="ftp://ftp.example.com/0.html" title="t">Lisp <b>Machines</b></a>.</p>';

		expect(sanitizeArticleHtml(ftpLink)).toBe(
			"<p>See <span>Lisp <b>Machines</b></span>.</p>",
		);
	});

	it("demotes a named anchor the capture carried, which is an anchor with no link in it", () => {
		const namedAnchor = '<p><a name="lispm">Lisp Machines</a></p>';

		expect(sanitizeArticleHtml(namedAnchor)).toBe(
			"<p><span>Lisp Machines</span></p>",
		);
	});

	it("drops a javascript: image source", () => {
		const scriptImage = '<img src="javascript:steal()" alt="x" />';

		expect(sanitizeArticleHtml(scriptImage)).toBe('<img alt="x" />');
	});

	it("keeps a link to a section in the same body, which a book's table of contents is made of", () => {
		const tocLink = '<a href="#section-ch-3">Chapter 3</a>';

		expect(sanitizeArticleHtml(tocLink)).toBe(tocLink);
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

	it("keeps a root-relative image source, which a private book serves its images from", () => {
		const bookImage =
			'<img src="/queue/a1b2c3/media/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.png" alt="Map" loading="lazy" />';

		expect(sanitizeArticleHtml(bookImage)).toBe(bookImage);
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

	it("drops every id outside the section- namespace so captured markup cannot clobber the swap targets around it", () => {
		const clobbering =
			'<div id="article-body-reader-slot">Body copy.</div><h2 id="table-of-contents">Heading</h2>';

		expect(sanitizeArticleHtml(clobbering)).toBe("<div>Body copy.</div><h2>Heading</h2>");
	});

	it("keeps a section- id on an h2 or h3, where the reader anchors its table of contents", () => {
		const anchored = '<h2 id="section-why-it-matters">Why it matters</h2><h3 id="section-how-to-start">How to start</h3>';

		expect(sanitizeArticleHtml(anchored)).toBe(anchored);
	});

	it("drops a section- id from any element other than an h2 or h3", () => {
		const elsewhere = '<h4 id="section-footnotes">Footnotes</h4><p id="section-body">Body copy.</p>';

		expect(sanitizeArticleHtml(elsewhere)).toBe("<h4>Footnotes</h4><p>Body copy.</p>");
	});

	it("keeps an image inside an unclosed noscript out of the body when the element around it closes first", () => {
		const hidden = '<div><noscript></div><img src="http://evil.test/t.gif"></noscript>';

		expect(sanitizeArticleHtml(hidden)).toBe("<div></div>");
	});

	it("does not turn a link inside an unclosed noscript into a live link", () => {
		const hidden = '<p><noscript></p><a href="https://evil.test/reset">Reset your password</a></noscript>';

		expect(sanitizeArticleHtml(hidden)).toBe("<p></p>");
	});

	it("ends a CDATA section at its first > so a noscript after it stays inert", () => {
		const hidden =
			'<p>Hi</p><![CDATA[ x > <noscript>]]><a href="https://evil.test/r">Reset your password</a><img src="https://evil.test/b.gif"></noscript>';

		expect(sanitizeArticleHtml(hidden)).toBe("<p>Hi</p> ");
	});

	it("keeps a data: candidate in an image's srcset, as it keeps one in src", () => {
		const responsive = '<img src="https://a.test/x.png" srcset="data:image/png;base64,AAAA 1x, https://a.test/y.png 2x">';

		expect(sanitizeArticleHtml(responsive)).toBe(
			'<img src="https://a.test/x.png" srcset="data:image/png;base64,AAAA 1x, https://a.test/y.png 2x" />',
		);
	});
});

describe("sanitizeArticleHtml on a highlight mark", () => {
	const highlightId = "0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";

	it("keeps the reader's highlight class, its highlight- id and a uuid data-highlight-id on a mark", () => {
		const mark = `<p><mark class="article-highlight" id="${ARTICLE_HIGHLIGHT_ID_PREFIX}${highlightId}" data-highlight-id="${highlightId}">kept</mark></p>`;

		expect(sanitizeArticleHtml(mark)).toBe(mark);
	});

	it("keeps the reader's has-note and note-end classes on a mark and drops any other", () => {
		expect(
			sanitizeArticleHtml(
				`<p><mark class="article-highlight article-highlight--has-note article-highlight--note-end article-highlight--other" data-highlight-id="${highlightId}">kept</mark></p>`,
			),
		).toBe(
			`<p><mark class="article-highlight article-highlight--has-note article-highlight--note-end" data-highlight-id="${highlightId}">kept</mark></p>`,
		);
	});

	it("drops a data-highlight-id that is not a uuid, an id outside the highlight- namespace and any other class", () => {
		expect(
			sanitizeArticleHtml('<p><mark class="pub-mark" id="note-1" data-highlight-id="javascript:alert(1)">text</mark></p>'),
		).toBe("<p><mark>text</mark></p>");
	});

	it("drops a highlight- id from any element other than a mark", () => {
		expect(sanitizeArticleHtml(`<h2 id="${ARTICLE_HIGHLIGHT_ID_PREFIX}${highlightId}">Heading</h2>`)).toBe("<h2>Heading</h2>");
	});
});

describe("sanitizeArticleHtml on MathML", () => {
	const X = "__x()";

	it("keeps a formula's presentation elements so the reader draws it", () => {
		const formula = "<math display=\"block\"><mfrac><mi>a</mi><mi>b</mi></mfrac><msqrt><mi>x</mi></msqrt></math>";

		expect(sanitizeArticleHtml(formula)).toBe(formula);
	});

	it("drops an annotation and its TeX so hidden source never enters the highlight text", () => {
		expect(
			sanitizeArticleHtml(
				'<p>Area <math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math> grows.</p>',
			),
		).toBe("<p>Area <math><semantics><mrow><mi>x</mi></mrow></semantics></math> grows.</p>");
	});

	it("drops an annotation-xml subtree and the markup it carries", () => {
		expect(
			sanitizeArticleHtml(
				`<math><semantics><mi>a</mi><annotation-xml encoding="text/html"><img src=x onerror=${X}></annotation-xml></semantics></math>`,
			),
		).toBe("<math><semantics><mi>a</mi></semantics></math>");
	});

	it("drops an annotation that carries HTML", () => {
		expect(
			sanitizeArticleHtml(
				`<math><semantics><mi>x</mi><annotation encoding="text/html"><img src=x onerror=${X}></annotation></semantics></math>`,
			),
		).toBe("<math><semantics><mi>x</mi></semantics></math>");
	});

	it("drops href, xlink:href, style, event, id and class attributes on a MathML element", () => {
		expect(
			sanitizeArticleHtml(
				`<math><mi href="javascript:${X}" xlink:href="https://evil.test/" style="color:red" onclick="${X}" id="queue-form" class="reader-toolbar">click</mi></math>`,
			),
		).toBe("<math><mi>click</mi></math>");
	});

	it("keeps only the listed values of display, mathvariant and displaystyle", () => {
		expect(
			sanitizeArticleHtml(
				'<math display="block"><mi mathvariant="bold">x</mi><mi mathvariant="normal">d</mi><mstyle displaystyle="true"><mn>1</mn></mstyle></math>',
			),
		).toBe(
			'<math display="block"><mi mathvariant>x</mi><mi mathvariant="normal">d</mi><mstyle displaystyle="true"><mn>1</mn></mstyle></math>',
		);
	});

	it("leaves a display value that tries to break out of its quotes as a bare attribute", () => {
		expect(sanitizeArticleHtml(`<math display='block" onmouseover="${X}'><mi>x</mi></math>`)).toBe(
			"<math display><mi>x</mi></math>",
		);
	});

	it("unwraps maction and malignmark and keeps what they hold", () => {
		expect([
			sanitizeArticleHtml(
				`<math><maction actiontype="statusline#http://x" onclick=${X}><mi>a</mi><mtext>b</mtext></maction></math>`,
			),
			sanitizeArticleHtml("<math><mtext><malignmark><mi>y</mi></malignmark></mtext></math>"),
		]).toEqual(["<math><mi>a</mi><mtext>b</mtext></math>", "<math><mtext><mi>y</mi></mtext></math>"]);
	});

	it("drops the stylesheet an mglyph tries to open inside a formula", () => {
		expect(sanitizeArticleHtml(`<math><mtext><table><mglyph><style><img src=x onerror=${X}>`)).toBe(
			"<math><mtext><table></table></mtext></math>",
		);
	});

	it("keeps only the src of an image a raw-text element tried to hide inside a formula", () => {
		expect(sanitizeArticleHtml(`<math><mi><table><xmp></xmp><img src=x onerror=${X}></table></mi></math>`)).toBe(
			'<math><mi><table><img src="x" /></table></mi></math>',
		);
	});

	it("drops a size or colour attribute that could overlay the page", () => {
		expect(
			sanitizeArticleHtml(
				'<math><mpadded width="100000px" height="100000px" lspace="-5000px"><mstyle mathbackground="red" mathsize="2000px" mathcolor="red"><mspace width="9000px"></mspace><mi>x</mi></mstyle></mpadded></math>',
			),
		).toBe("<math><mpadded><mstyle><mspace></mspace><mi>x</mi></mstyle></mpadded></math>");
	});

	it("drops an id, class or name on a formula so it cannot clobber the page around it", () => {
		expect(
			sanitizeArticleHtml('<math id="__x" class="reader-toolbar" name="cookie"><mi id="queue-form">x</mi></math>'),
		).toBe("<math><mi>x</mi></math>");
	});

	it("demotes a link inside a formula whose scheme it dropped", () => {
		expect(sanitizeArticleHtml(`<math><a href="javascript:${X}"><mi>x</mi></a></math>`)).toBe(
			"<math><span><mi>x</mi></span></math>",
		);
	});

	it("removes an svg subtree inside a formula", () => {
		expect(
			sanitizeArticleHtml('<math><mi>x</mi><svg><a href="https://evil.test/">s</a></svg><mn>2</mn></math>'),
		).toBe("<math><mi>x</mi><mn>2</mn></math>");
	});

	it("serves only allow-listed markup when a paragraph closes inside an annotation", () => {
		expect(
			sanitizeArticleHtml(
				`<p><math><semantics><mi>a</mi><annotation-xml encoding="text/html"></p><a href="https://evil.test/x">leak</a><img src=x onerror=${X}></annotation-xml></semantics></math>`,
			),
		).toBe('<p><math><semantics><mi>a</mi></semantics></math></p><a href="https://evil.test/x">leak</a><img src="x" />');
	});
});

describe("chapterSectionId", () => {
	it("names a book chapter's heading id from its 1-based position", () => {
		expect(chapterSectionId(3)).toBe("section-ch-3");
	});

	it("is recognised as a chapter id by isChapterSectionId, and a slugged heading id is not", () => {
		expect([chapterSectionId(12), "section-ch-0", "section-ch-3-2", "section-chapter-one"].map(isChapterSectionId)).toEqual([
			true,
			false,
			false,
			false,
		]);
	});
});

describe("sanitizeArticleHtml on a measured image", () => {
	it.each([
		[
			'<img src="https://cdn.x/a.png" data-reader-image-size="1456x1005" width="1456" height="1005">',
			'<img src="https://cdn.x/a.png" width="1456" height="1005" data-reader-image-size="1456x1005" style="--reader-image-width:1456px;--reader-image-ratio:1456 / 1005" />',
		],
		[
			'<img src="https://cdn.x/a.png" data-reader-image-size="1456x1005 100vw" style="width:5px">',
			'<img src="https://cdn.x/a.png" data-reader-image-size="1456x1005 100vw" style="--reader-image-width:100vw;--reader-image-ratio:1456 / 1005" />',
		],
		[
			'<img src="https://cdn.x/a.png" data-reader-image-size="1024x683 min(100vw,1024px)">',
			'<img src="https://cdn.x/a.png" data-reader-image-size="1024x683 min(100vw,1024px)" style="--reader-image-width:min(100vw,1024px);--reader-image-ratio:1024 / 683" />',
		],
		[
			'<img src="https://cdn.x/a.png" data-reader-image-size="1024x683 600px">',
			'<img src="https://cdn.x/a.png" data-reader-image-size="1024x683 600px" style="--reader-image-width:600px;--reader-image-ratio:1024 / 683" />',
		],
		[
			'<img src="https://cdn.x/a.png" data-reader-image-size="0x5" style="--reader-image-width:9999px;--reader-image-ratio:1 / 1">',
			'<img src="https://cdn.x/a.png" />',
		],
		[
			'<img src="https://cdn.x/a.png" style="--reader-image-width:9999px;--reader-image-ratio:1 / 1;position:fixed">',
			'<img src="https://cdn.x/a.png" />',
		],
		['<img src="https://cdn.x/a.png" data-reader-image-size="10x5;position:fixed">', '<img src="https://cdn.x/a.png" />'],
	])("writes the box only from a valid stored size: %s", (input, expected) => {
		expect(sanitizeArticleHtml(input)).toBe(expected);
	});

	it("gives the same output when run over its own output", () => {
		const once = sanitizeArticleHtml(
			'<img src="https://cdn.x/a.png" srcset="https://cdn.x/a.png 1456w" sizes="100vw" data-reader-image-size="1456x1005 100vw">',
		);

		expect(sanitizeArticleHtml(once)).toBe(once);
	});

	it("leaves an unmeasured image's publisher width and height of zero as they are", () => {
		const zero = '<img src="https://cdn.x/a.png" width="0" height="0" />';

		expect(sanitizeArticleHtml(zero)).toBe(zero);
	});

	it("keeps an image with no source", () => {
		expect(sanitizeArticleHtml('<img alt="x">')).toBe('<img alt="x" />');
	});
});
