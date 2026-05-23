import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderReady } from "./reader-ready.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function readSrcdoc(doc: Document): Document {
	const iframe = doc.querySelector("iframe[data-reader-iframe]");
	assert(iframe, "reader iframe must be rendered");
	const srcdoc = iframe.getAttribute("srcdoc");
	assert(srcdoc, "iframe must carry a srcdoc attribute");
	return new JSDOM(srcdoc).window.document;
}

describe("renderReaderReady", () => {
	it("renders the article content inside a sandboxed iframe", () => {
		const doc = parse(renderReaderReady({ content: "<p>Body copy</p>" }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("ready");

		const iframeDoc = readSrcdoc(doc);
		assert(iframeDoc.body, "iframe body must exist");
		expect(iframeDoc.body.innerHTML.trim()).toBe("<p>Body copy</p>");
	});

	it("preserves the legacy data-test-reader-content attribute on the iframe so existing tests can target the body", () => {
		const doc = parse(renderReaderReady({ content: "<p>x</p>" }));

		const legacyTarget = doc.querySelector("[data-test-reader-content]");
		assert(legacyTarget, "legacy data-test-reader-content must be present");
		expect(legacyTarget.tagName).toBe("IFRAME");
	});

	it("declares a sandbox attribute that blocks scripts and permits parent-tab navigation", () => {
		const doc = parse(renderReaderReady({ content: "<p>x</p>" }));

		const iframe = doc.querySelector("iframe[data-reader-iframe]");
		assert(iframe, "reader iframe must be rendered");
		const sandbox = iframe.getAttribute("sandbox");
		assert(sandbox, "iframe must declare a sandbox attribute");

		const flags = sandbox.split(/\s+/);
		// allow-scripts intentionally absent: captured page JS must not run.
		expect(flags).not.toContain("allow-scripts");
		// allow-same-origin lets the parent measure contentDocument scrollHeight.
		expect(flags).toContain("allow-same-origin");
		// allow-top-navigation-by-user-activation lets in-article links retarget _top.
		expect(flags).toContain("allow-top-navigation-by-user-activation");
		// allow-popups + allow-popups-to-escape-sandbox keep target=_blank links usable.
		expect(flags).toContain("allow-popups");
		expect(flags).toContain("allow-popups-to-escape-sandbox");
	});

	it("HTML-escapes the srcdoc attribute so iframe content cannot break out of the attribute and inject parent-page markup", () => {
		const doc = parse(
			renderReaderReady({
				content: '<p>safe</p><img src="x" onerror="alert(1)">',
			}),
		);

		const iframe = doc.querySelector("iframe[data-reader-iframe]");
		assert(iframe, "iframe must be rendered");
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "iframe must carry srcdoc");
		// The attribute value must round-trip through DOM parsing — JSDOM has
		// already unescaped the entities, so the raw quote must round-trip
		// correctly and the dangerous attributes survive only inside the iframe
		// boundary.
		expect(srcdoc).toContain('<img src="x" onerror="alert(1)">');
		// No spurious parent-side script tag escaped from the attribute.
		expect(doc.querySelectorAll("script").length).toBe(0);
	});

	it("matches parent theme via prefers-color-scheme so the iframe never flashes the wrong mode", () => {
		const doc = parse(renderReaderReady({ content: "<p>x</p>" }));
		const iframeDoc = readSrcdoc(doc);
		const style = iframeDoc.querySelector("style");
		assert(style, "iframe document must embed reader CSS");

		const css = style.textContent ?? "";
		expect(css).toContain("prefers-color-scheme: dark");
	});

	it("flags the iframe with hx-swap-oob when oob is true so HTMX swaps replace the live slot", () => {
		const doc = parse(
			renderReaderReady({ content: "<p>x</p>", oob: true }),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("hx-swap-oob")).toBe("outerHTML");
	});

	it("omits hx-swap-oob when oob is absent (initial SSR render)", () => {
		const doc = parse(renderReaderReady({ content: "<p>x</p>" }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.hasAttribute("hx-swap-oob")).toBe(false);
	});
});
