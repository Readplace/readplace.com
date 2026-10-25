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
			crawlArticle: async () => ({ status: "failed" }),
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
});
