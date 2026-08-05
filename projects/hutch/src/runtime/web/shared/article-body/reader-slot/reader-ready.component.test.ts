import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReaderReady } from "./reader-ready.component";

function parse(html: string) {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
}

function readerContent(doc: Document): Element {
	const content = doc.querySelector("[data-test-reader-content]");
	assert(content, "reader content must be rendered");
	return content;
}

describe("renderReaderReady", () => {
	it("renders the article content as document text a reader or extractor can read", () => {
		const doc = parse(renderReaderReady({ appOrigin: "https://readplace.com", content: "<p>Body copy</p>" }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("data-reader-status")).toBe("ready");
		expect(readerContent(doc).innerHTML.trim()).toBe("<p>Body copy</p>");
		expect(doc.body.textContent).toContain("Body copy");
	});

	it("carries the article content on a styled div, not a frame the page has to measure", () => {
		const doc = parse(renderReaderReady({ appOrigin: "https://readplace.com", content: "<p>x</p>" }));

		const content = readerContent(doc);
		expect(content.tagName).toBe("DIV");
		expect(content.classList.contains("article-body__content")).toBe(true);
	});

	it("strips event-handler attributes from captured markup, which the page origin would otherwise execute", () => {
		const doc = parse(
			renderReaderReady({
				content: '<p>safe</p><img src="https://cdn.example.com/x.jpg" onerror="alert(1)">',
				appOrigin: "https://readplace.com",
			}),
		);

		const image = readerContent(doc).querySelector("img");
		assert(image, "the captured image must still render");
		expect(image.getAttribute("src")).toBe("https://cdn.example.com/x.jpg");
		expect(image.hasAttribute("onerror")).toBe(false);
	});

	it("strips a captured stylesheet so article CSS cannot repaint the page around it", () => {
		const doc = parse(
			renderReaderReady({
				content: "<style>body { position: fixed; }</style><p>safe</p>",
				appOrigin: "https://readplace.com",
			}),
		);

		expect(readerContent(doc).innerHTML.trim()).toBe("<p>safe</p>");
	});

	it("retargets a same-host link to the reader's own tab", () => {
		const doc = parse(
			renderReaderReady({
				content: '<a href="https://readplace.com/queue" target="_blank">Queue</a>',
				appOrigin: "https://readplace.com",
			}),
		);

		const link = readerContent(doc).querySelector("a");
		assert(link, "the captured link must still render");
		expect(link.getAttribute("target")).toBe("_top");
	});

	it("leaves an external link's own target alone", () => {
		const doc = parse(
			renderReaderReady({
				content: '<a href="https://example.com/post" target="_blank">Post</a>',
				appOrigin: "https://readplace.com",
			}),
		);

		const link = readerContent(doc).querySelector("a");
		assert(link, "the captured link must still render");
		expect(link.getAttribute("target")).toBe("_blank");
	});

	it("flags the slot with hx-swap-oob when oob is true so HTMX swaps replace the live slot", () => {
		const doc = parse(
			renderReaderReady({ content: "<p>x</p>", oob: true, appOrigin: "https://readplace.com" }),
		);

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.getAttribute("hx-swap-oob")).toBe("outerHTML");
	});

	it("omits hx-swap-oob when oob is absent (initial SSR render)", () => {
		const doc = parse(renderReaderReady({ appOrigin: "https://readplace.com", content: "<p>x</p>" }));

		const slot = doc.querySelector("[data-test-reader-slot]");
		assert(slot, "reader slot must be rendered");
		expect(slot.hasAttribute("hx-swap-oob")).toBe(false);
	});
});
