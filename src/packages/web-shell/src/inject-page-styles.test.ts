import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { injectPageStylesIntoMain, pageStylesheetPreload } from "./inject-page-styles";

describe("injectPageStylesIntoMain", () => {
	it("inserts inline CSS as a <style> first child of <main> for the string variant", () => {
		const html = injectPageStylesIntoMain(
			"<main><p>Body</p></main>",
			".lead { color: rebeccapurple; }",
		);
		const main = new JSDOM(html).window.document.querySelector("main");
		assert(main, "output must contain <main>");
		assert.equal(main.firstElementChild?.tagName, "STYLE");
		assert.equal(main.querySelector("style")?.textContent, ".lead { color: rebeccapurple; }");
	});

	it("inserts a stylesheet <link> first child of <main> for the href variant", () => {
		const html = injectPageStylesIntoMain("<main><p>Body</p></main>", {
			href: "/styles/queue.abc123def456.css",
		});
		const main = new JSDOM(html).window.document.querySelector("main");
		assert(main, "output must contain <main>");
		const link = main.firstElementChild;
		assert.equal(link?.tagName, "LINK");
		assert.equal(link?.getAttribute("rel"), "stylesheet");
		assert.equal(link?.getAttribute("href"), "/styles/queue.abc123def456.css");
	});

	it("preserves the <main>'s attributes when injecting either variant", () => {
		const styleHtml = injectPageStylesIntoMain('<main class="reader"><p>x</p></main>', ".a{}");
		const linkHtml = injectPageStylesIntoMain('<main class="reader"><p>x</p></main>', {
			href: "/styles/reader.0123456789ab.css",
		});
		assert.equal(new JSDOM(styleHtml).window.document.querySelector("main")?.className, "reader");
		assert.equal(new JSDOM(linkHtml).window.document.querySelector("main")?.className, "reader");
	});

	it("returns the content untouched when the inline string is empty", () => {
		const content = "<main><p>No styles</p></main>";
		assert.equal(injectPageStylesIntoMain(content, ""), content);
	});

	it("throws when styles are provided but there is no <main> to host them", () => {
		assert.throws(() => injectPageStylesIntoMain("<section><p>x</p></section>", ".a{}"));
		assert.throws(() =>
			injectPageStylesIntoMain("<section><p>x</p></section>", { href: "/styles/x.0123456789ab.css" }),
		);
	});

	it("keeps the reader iframe's double-escaped srcdoc intact under the href variant", () => {
		const srcdoc = "&lt;code&gt;&amp;lt;input&amp;gt;&lt;/code&gt;";
		const html = injectPageStylesIntoMain(
			`<main><iframe data-reader-iframe srcdoc="${srcdoc}"></iframe></main>`,
			{ href: "/styles/reader.0123456789ab.css" },
		);
		assert.ok(html.includes("&amp;lt;input&amp;gt;"));
	});
});

describe("pageStylesheetPreload", () => {
	it("emits nothing for the inline string variant", () => {
		assert.equal(pageStylesheetPreload(".a{}"), "");
		assert.equal(pageStylesheetPreload(""), "");
	});

	it("emits a style preload <link> for the href variant", () => {
		const link = new JSDOM(
			`<head>${pageStylesheetPreload({ href: "/styles/queue.abc123def456.css" })}</head>`,
		).window.document.querySelector("link");
		assert.equal(link?.getAttribute("rel"), "preload");
		assert.equal(link?.getAttribute("as"), "style");
		assert.equal(link?.getAttribute("href"), "/styles/queue.abc123def456.css");
	});
});
