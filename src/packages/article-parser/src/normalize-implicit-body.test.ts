import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { normalizeImplicitBody } from "./normalize-implicit-body";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

describe("normalizeImplicitBody", () => {
	it("gives a page with no <body> a head for its metadata and a body for its flow content", () => {
		const { document } = parseHTML(
			'<html><base href="https://hex.ooo/"><meta charset="utf-8"><title>Hex</title><link rel="stylesheet" href="/library.css"><style>main{margin:0}</style><script src="/menu.js"></script><nav>Menu</nav><main><p>Post body</p></main></html>',
		);

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			'<html><head><base href="https://hex.ooo/"><meta charset="utf-8"><title>Hex</title><link rel="stylesheet" href="/library.css"><style>main{margin:0}</style><script src="/menu.js"></script></head><body><nav>Menu</nav><main><p>Post body</p></main></body></html>',
		);
	});

	it("moves the flow content of a never-closed <head> into the body, keeping its metadata", () => {
		const { document } = parseHTML(
			'<html><head><title>Unplanned</title><meta name="description" content="Obsolescence"><h1>Unplanned obsolescence</h1><p>Post body</p></html>',
		);

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			'<html><head><title>Unplanned</title><meta name="description" content="Obsolescence"></head><body><h1>Unplanned obsolescence</h1><p>Post body</p></body></html>',
		);
	});

	it("leaves a page whose head and body are already in place exactly as it was", () => {
		const { document } = parseHTML(
			"<html><head><title>Post</title></head><body><article><p>Post body</p></article></body></html>",
		);

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			"<html><head><title>Post</title></head><body><article><p>Post body</p></article></body></html>",
		);
	});

	it("wraps top-level head and body siblings while preserving their doctype, order, and content", () => {
		const { document } = parseHTML(
			'<!DOCTYPE html><head><title>Message archive</title><meta name="description" content="An archived message"></head><body><pre>Opening <a href="/thread/2">next message</a> closing</pre></body>',
		);

		normalizeImplicitBody(document);

		expect(document.doctype?.name).toBe("html");
		expect(document.documentElement.outerHTML).toBe(
			'<html><head><title>Message archive</title><meta name="description" content="An archived message"></head><body><pre>Opening <a href="/thread/2">next message</a> closing</pre></body></html>',
		);
	});

	it("leaves a well-formed document with a doctype unchanged", () => {
		const source = '<!DOCTYPE html><html><head><title>Post</title></head><body><main>Body</main></body></html>';
		const { document } = parseHTML(source);
		const before = document.toString();

		normalizeImplicitBody(document);

		expect(document.toString()).toBe(before);
	});

	it("keeps the opening, closing, and resolved links of an archived message through Readability", () => {
		const opening = "Opening passage explains the problem with enough detail to identify this message.";
		const closing = "Closing passage gives the solution and its final context for the reader.";
		const html = `<head><title>Archived discussion</title></head><body><pre>${opening.repeat(12)} <a href="/thread/2">Next message</a> <a href="https://example.test/reference">Reference</a> ${closing.repeat(12)}</pre></body>`;
		const url = "https://example.test/thread/1";
		const parser = initReadabilityParser({
			crawlArticle: async () => ({ status: "failed", decision: undefined }),
			siteRules: [],
			readabilityAdditions,
			logError: () => {},
		});

		const result = parser.parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.article.title).toBe("Archived discussion");
		expect(result.article.wordCount).toBeGreaterThan(100);
		expect(result.article.content).toContain(opening);
		expect(result.article.content).toContain(closing);
		expect(result.article.content).toContain('href="https://example.test/thread/2"');
		expect(result.article.content).toContain('href="https://example.test/reference"');
	});

	it("gives a page that omits the <html>, <head> and <body> start tags a root, then a head for its metadata and a body for its flow content", () => {
		const { document } = parseHTML('<!doctype html><meta charset="utf-8"><title>x</title><p>Post body</p>');

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			'<html><head><meta charset="utf-8"><title>x</title></head><body><p>Post body</p></body></html>',
		);
		expect(Array.from(document.childNodes).map((node) => node.nodeName)).toEqual(["#document-type", "HTML"]);
	});

	it("keeps the real <html> as the root when a stray <script> precedes it, filing the script into its head", () => {
		const { document } = parseHTML(
			'<!DOCTYPE html><script>var a=1</script><html><head><title>Real</title></head><body><p>Post body</p></body></html>',
		);

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			'<html><head><title>Real</title><script>var a=1</script></head><body><p>Post body</p></body></html>',
		);
		expect(Array.from(document.childNodes).map((node) => node.nodeName)).toEqual(["#document-type", "HTML"]);
	});

	it("moves an element that follows </html> into the body and a trailing <script> into the head, leaving <html> the document's only element", () => {
		const { document } = parseHTML(
			"<!DOCTYPE html><html><head><title>Lorem</title></head><body><p>Dolor sit.</p></body></html><div><footer><p>Lorem ipsum dolor sit amet.</p></footer></div><script>var a=1</script>",
		);

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			"<html><head><title>Lorem</title><script>var a=1</script></head><body><p>Dolor sit.</p><div><footer><p>Lorem ipsum dolor sit amet.</p></footer></div></body></html>",
		);
		expect(Array.from(document.childNodes).map((node) => node.nodeName)).toEqual(["#document-type", "HTML"]);
	});

	it("keeps article paragraphs that follow </html>", () => {
		const first = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ";
		const second = "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae. ";
		const html = `<!DOCTYPE html><html><head><title>Lorem ipsum</title></head><body><article><p>${first.repeat(6)}</p><p>${first.repeat(6)}</p></article></body></html><div><section><p>${second.repeat(6)}</p><p>${second.repeat(6)}</p></section></div>`;
		const url = "https://example.com/lorem-ipsum";
		const parser = initReadabilityParser({
			crawlArticle: async () => ({ status: "failed", decision: undefined }),
			siteRules: [],
			readabilityAdditions,
			logError: () => {},
		});

		const result = parser.parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });

		assert(result.ok, "the page parses");
		expect(result.article.content).toContain("Lorem ipsum dolor sit amet");
		expect(result.article.content).toContain("Vestibulum ante ipsum");
	});

	describe("an SEC EDGAR filing served inside its SGML wrapper", () => {
		const edgarFiling = (documents: readonly { title: string; body: string }[]) =>
			documents
				.map(
					({ title, body }, index) =>
						`<DOCUMENT>\n<TYPE>S-1/A\n<SEQUENCE>${index + 1}\n<FILENAME>d${index}.htm\n<DESCRIPTION>S-1/A\n<TEXT>\n<html><head><title>${title}</title></head><body>${body}</body></html>\n</TEXT>\n</DOCUMENT>`,
				)
				.join("\n");

		it("roots the document at the filing's own <html>, keeping its title and body", () => {
			const { document } = parseHTML(
				edgarFiling([{ title: "Anthropic, PBC - S-1/A-1", body: "<p>Filing body</p>" }]),
			);

			normalizeImplicitBody(document);

			expect(document.title).toBe("Anthropic, PBC - S-1/A-1");
			expect(document.documentElement.outerHTML).toBe(
				"<html><head><title>Anthropic, PBC - S-1/A-1</title></head><body><p>Filing body</p></body></html>",
			);
		});

		it("keeps only the first document of a multi-document file, which is the filing itself", () => {
			const { document } = parseHTML(
				edgarFiling([
					{ title: "Anthropic, PBC - S-1/A-1", body: "<p>Filing body</p>" },
					{ title: "Exhibit 23.1", body: "<p>Consent of auditors</p>" },
				]),
			);

			normalizeImplicitBody(document);

			expect(document.title).toBe("Anthropic, PBC - S-1/A-1");
			expect(document.body.textContent).toBe("Filing body");
		});

		it("drops the later documents of a multi-document file that opens with a doctype, keeping the doctype", () => {
			const { document } = parseHTML(
				`<!DOCTYPE html>\n${edgarFiling([
					{ title: "Anthropic, PBC - S-1/A-1", body: "<p>Filing body</p>" },
					{ title: "Exhibit 23.1", body: "<p>Consent of auditors</p>" },
				])}`,
			);

			normalizeImplicitBody(document);

			expect(Array.from(document.childNodes).map((node) => node.nodeName)).toEqual([
				"#document-type",
				"#text",
				"HTML",
				"#text",
			]);
			expect(document.body.textContent).toBe("Filing body");
		});

		it("wraps an EDGAR document whose text holds no <html> as before", () => {
			const { document } = parseHTML("<DOCUMENT>\n<TYPE>GRAPHIC\n<TEXT>\nbegin 644 chart.jpg\n</TEXT>\n</DOCUMENT>");

			normalizeImplicitBody(document);

			expect(document.documentElement.outerHTML).toBe(
				"<html><head></head><body><document>\n<type>GRAPHIC\n<text>\nbegin 644 chart.jpg\n</text>\n</type></document></body></html>",
			);
		});

		it("parses with the filing's title through Readability", () => {
			const paragraph = "The registrant is offering shares of its common stock in this proposed public offering. ";
			const url = "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/d0.htm";
			const parser = initReadabilityParser({
				crawlArticle: async () => ({ status: "failed", decision: undefined }),
				siteRules: [],
				readabilityAdditions,
				logError: () => {},
			});

			const result = parser.parseHtml({
				url,
				documentUrl: url,
				html: edgarFiling([{ title: "Anthropic, PBC - S-1/A-1", body: `<p>${paragraph.repeat(20)}</p>` }]),
				thumbnailUrl: null,
			});

			assert(result.ok, "the filing parses");
			expect(result.article.title).toBe("Anthropic, PBC - S-1/A-1");
			expect(result.article.content).toContain(paragraph.trim());
		});
	});

	it("keeps a <div> fragment's nested <html> where it is, wrapping the fragment as before", () => {
		const { document } = parseHTML("<div><p>Intro</p><html><p>Nested</p></html></div>");

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			"<html><head></head><body><div><p>Intro</p><html><p>Nested</p></html></div></body></html>",
		);
	});

	it("wraps a document rooted at <body> as before", () => {
		const { document } = parseHTML("<body><p>Post body</p></body>");

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe("<html><head></head><body><p>Post body</p></body></html>");
	});

	it("wraps a document rooted at <svg> as before", () => {
		const { document } = parseHTML('<svg xmlns="http://www.w3.org/2000/svg"><text>Chart</text></svg>');

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			'<html><head></head><body><svg xmlns="http://www.w3.org/2000/svg"><text>Chart</text></svg></body></html>',
		);
	});

	it("wraps an RSS document as before", () => {
		const { document } = parseHTML('<rss version="2.0"><channel><title>Feed</title><item><title>Post</title></item></channel></rss>');

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			'<html><head></head><body><rss version="2.0"><channel><title>Feed</title><item><title>Post</title></item></channel></rss></body></html>',
		);
	});
});
