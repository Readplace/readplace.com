import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildReaderIframeSrcdoc } from "./reader-iframe-srcdoc";

describe("buildReaderIframeSrcdoc", () => {
	it("returns a full HTML document containing the article content inside the body", () => {
		const srcdoc = buildReaderIframeSrcdoc({ content: "<p>Body copy</p>" });
		const doc = new JSDOM(srcdoc).window.document;

		assert(doc.body, "iframe document must have a body");
		expect(doc.body.classList.contains("article-body__content")).toBe(true);
		expect(doc.body.innerHTML.trim()).toBe("<p>Body copy</p>");
	});

	it("injects a <base target=\"_top\"> so links navigate the parent tab", () => {
		const srcdoc = buildReaderIframeSrcdoc({ content: "" });
		const doc = new JSDOM(srcdoc).window.document;

		const base = doc.querySelector("base");
		assert(base, "iframe document must declare a <base> element");
		expect(base.getAttribute("target")).toBe("_top");
	});

	it("declares utf-8 and a viewport so reader typography renders correctly across devices", () => {
		const srcdoc = buildReaderIframeSrcdoc({ content: "" });
		const doc = new JSDOM(srcdoc).window.document;

		expect(doc.querySelector("meta[charset]")?.getAttribute("charset")).toBe(
			"utf-8",
		);
		expect(
			doc.querySelector('meta[name="viewport"]')?.getAttribute("content"),
		).toBe("width=device-width, initial-scale=1");
	});

	it("embeds reader CSS scoped to .article-body__content typography rules", () => {
		const srcdoc = buildReaderIframeSrcdoc({ content: "<p>x</p>" });
		const doc = new JSDOM(srcdoc).window.document;

		const style = doc.querySelector("style");
		assert(style, "iframe document must embed a <style> block");
		const css = style.textContent ?? "";
		expect(css).toContain(".article-body__content");
		expect(css).toContain("--color-text-primary");
		expect(css).toContain("prefers-color-scheme: dark");
	});

	it("keeps the iframe body and html backgrounds transparent so the parent surface shows through", () => {
		const srcdoc = buildReaderIframeSrcdoc({ content: "" });
		const doc = new JSDOM(srcdoc).window.document;
		const style = doc.querySelector("style");
		assert(style, "style block must exist");
		const css = style.textContent ?? "";

		expect(css).toContain("background: transparent");
	});

	it("does not strip the article content's own tags (the sandbox is responsible for isolation)", () => {
		const dangerous =
			'<p>safe</p><style>html{display:none}</style><img onerror="x">';
		const srcdoc = buildReaderIframeSrcdoc({ content: dangerous });
		const doc = new JSDOM(srcdoc).window.document;
		assert(doc.body, "body must be present");

		expect(doc.body.innerHTML).toContain("<p>safe</p>");
		expect(doc.body.innerHTML).toContain("<style>html{display:none}</style>");
		expect(doc.body.innerHTML).toContain('<img onerror="x">');
	});
});
