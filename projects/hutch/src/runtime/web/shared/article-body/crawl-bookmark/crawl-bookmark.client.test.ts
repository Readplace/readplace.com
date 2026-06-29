import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initCrawlBookmark } from "./crawl-bookmark.client";

function initWithDom(
	bodyHtml: string,
	isNarrow: boolean,
): { document: Document; triggerSwap: () => void } {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
	let swapListener: (() => void) | undefined;
	initCrawlBookmark({
		document: dom.window.document,
		isNarrow: () => isNarrow,
		addSwapListener: (listener) => {
			swapListener = listener;
		},
	}).attach();
	return {
		document: dom.window.document,
		triggerSwap: () => {
			assert(swapListener, "a swap listener must be registered");
			swapListener();
		},
	};
}

const OPEN_BOOKMARK = `<details class="crawl-bookmark" open><summary class="crawl-bookmark__handle"></summary></details>`;
const CLOSED_BOOKMARK = `<details class="crawl-bookmark"><summary class="crawl-bookmark__handle"></summary></details>`;

describe("initCrawlBookmark", () => {
	it("collapses the bookmark on a narrow viewport", () => {
		const { document } = initWithDom(OPEN_BOOKMARK, true);
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(false);
	});

	it("opens the bookmark on a wide viewport", () => {
		const { document } = initWithDom(CLOSED_BOOKMARK, false);
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(true);
	});

	it("re-applies the per-viewport default after an htmx swap", () => {
		const { document, triggerSwap } = initWithDom("", true);
		document.body.innerHTML = OPEN_BOOKMARK;
		triggerSwap();
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(false);
	});

	it("no-ops when no bookmark is present (article still crawling)", () => {
		const { document } = initWithDom(`<main></main>`, false);
		expect(document.querySelector(".crawl-bookmark")).toBeNull();
	});
});
