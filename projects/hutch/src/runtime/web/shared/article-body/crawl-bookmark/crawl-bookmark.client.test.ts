import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initCrawlBookmark } from "./crawl-bookmark.client";

const STORAGE_KEY = "readplace.crawl-bookmark-dismissed";

type BookmarkStorage = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
};

function initWithDom(
	bodyHtml: string,
	isNarrow: boolean,
	storage?: BookmarkStorage,
): {
	document: Document;
	storage: BookmarkStorage;
	triggerSwap: (swapTarget: ParentNode) => void;
} {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, {
		url: "https://readplace.com/view",
	});
	const bookmarkStorage = storage ?? dom.window.localStorage;
	let swapListener: ((swapTarget: ParentNode) => void) | undefined;
	initCrawlBookmark({
		document: dom.window.document,
		isNarrow: () => isNarrow,
		storage: bookmarkStorage,
		addSwapListener: (listener) => {
			swapListener = listener;
		},
	}).attach();
	return {
		document: dom.window.document,
		storage: bookmarkStorage,
		triggerSwap: (swapTarget) => {
			assert(swapListener, "a swap listener must be registered");
			swapListener(swapTarget);
		},
	};
}

const OPEN_BOOKMARK = `<details class="crawl-bookmark" open><summary class="crawl-bookmark__handle"></summary></details>`;
const CLOSED_BOOKMARK = `<details class="crawl-bookmark"><summary class="crawl-bookmark__handle"></summary></details>`;
const HANDLELESS_BOOKMARK = `<details class="crawl-bookmark" open></details>`;
const BOOKMARK_WITH_TABS = `<details class="crawl-bookmark" open><summary class="crawl-bookmark__handle"></summary><ul class="crawl-bookmark__tabs"><li class="crawl-bookmark__tab crawl-bookmark__tab--current" aria-disabled="false"><time class="crawl-bookmark__time">10 Jul '26, 09:14</time><span class="crawl-bookmark__badge">latest</span></li><li class="crawl-bookmark__tab crawl-bookmark__tab--disabled" aria-disabled="true"><time class="crawl-bookmark__time">28 Jun '26, 22:01</time></li></ul></details>`;

function pickTabs(document: Document): HTMLElement {
	const tabs = document.querySelector<HTMLElement>(".crawl-bookmark__tabs");
	assert(tabs, "the info panel must be present");
	return tabs;
}

function pickHandle(document: Document): HTMLElement {
	const handle = document.querySelector<HTMLElement>(".crawl-bookmark__handle");
	assert(handle, "the handle must be present");
	return handle;
}

describe("initCrawlBookmark", () => {
	it("collapses the bookmark on a narrow viewport", () => {
		const { document } = initWithDom(OPEN_BOOKMARK, true);
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(false);
	});

	it("opens the bookmark on a wide viewport", () => {
		const { document } = initWithDom(CLOSED_BOOKMARK, false);
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(true);
	});

	it("marks the bookmark JS-enhanced so the no-JS CSS collapse stops applying", () => {
		const { document } = initWithDom(OPEN_BOOKMARK, false);
		expect(
			document.querySelector(".crawl-bookmark")?.classList.contains("crawl-bookmark--js"),
		).toBe(true);
	});

	it("re-applies the per-viewport default when a swap delivers a fresh bookmark", () => {
		const { document, triggerSwap } = initWithDom("", true);
		document.body.innerHTML = OPEN_BOOKMARK;
		triggerSwap(document.body);
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(false);
	});

	it("leaves a manually-toggled bookmark alone when the swapped fragment has no bookmark", () => {
		const { document, triggerSwap } = initWithDom(OPEN_BOOKMARK, false);
		const bookmark = document.querySelector(".crawl-bookmark");
		assert(bookmark, "the bookmark must be present");
		bookmark.removeAttribute("open");
		triggerSwap(document.createElement("div"));
		expect(bookmark.hasAttribute("open")).toBe(false);
	});

	it("no-ops when no bookmark is present (article still crawling)", () => {
		const { document } = initWithDom(`<main></main>`, false);
		expect(document.querySelector(".crawl-bookmark")).toBeNull();
	});

	it("toggles the whole capsule when the info panel — not just the handle — is clicked", () => {
		const { document } = initWithDom(BOOKMARK_WITH_TABS, false);
		const bookmark = document.querySelector(".crawl-bookmark");
		assert(bookmark, "the bookmark must be present");
		const tabs = pickTabs(document);
		assert.equal(bookmark.hasAttribute("open"), true, "a wide viewport starts open");
		tabs.click();
		assert.equal(bookmark.hasAttribute("open"), false, "clicking the panel closes it");
		tabs.click();
		assert.equal(bookmark.hasAttribute("open"), true, "clicking the panel opens it again");
	});

	it("toggles the whole capsule even when a disabled version tab is clicked", () => {
		const { document } = initWithDom(BOOKMARK_WITH_TABS, false);
		const bookmark = document.querySelector(".crawl-bookmark");
		assert(bookmark, "the bookmark must be present");
		const disabledTab = document.querySelector<HTMLElement>(".crawl-bookmark__tab--disabled");
		assert(disabledTab, "a disabled version tab must be present");
		assert.equal(bookmark.hasAttribute("open"), true, "a wide viewport starts open");
		disabledTab.click();
		assert.equal(bookmark.hasAttribute("open"), false, "clicking a disabled tab closes the capsule");
	});

	it("binds the panel toggle once, so re-syncing the same bookmark can't stack listeners", () => {
		const { document, triggerSwap } = initWithDom(BOOKMARK_WITH_TABS, false);
		triggerSwap(document.body);
		const bookmark = document.querySelector(".crawl-bookmark");
		assert(bookmark, "the bookmark must be present");
		const tabs = pickTabs(document);
		tabs.click();
		assert.equal(bookmark.hasAttribute("open"), false, "a single click toggles exactly once");
	});

	it("applies the viewport default to a bookmark without a handle", () => {
		const { document } = initWithDom(HANDLELESS_BOOKMARK, true);
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(false);
	});
});

describe("initCrawlBookmark — dismissal persistence", () => {
	it("persists the dismissal when the info panel closes the capsule", () => {
		const { document, storage } = initWithDom(BOOKMARK_WITH_TABS, false);
		pickTabs(document).click();
		expect(storage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("persists the dismissal when the handle collapses the open capsule", () => {
		const { document, storage } = initWithDom(OPEN_BOOKMARK, false);
		pickHandle(document).click();
		expect(storage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("does not persist a dismissal when the handle opens a collapsed capsule", () => {
		const { document, storage } = initWithDom(CLOSED_BOOKMARK, true);
		pickHandle(document).click();
		expect(storage.getItem(STORAGE_KEY)).toBe(null);
	});

	it("starts collapsed on a wide viewport once the user closed it on an earlier page", () => {
		const firstPage = initWithDom(BOOKMARK_WITH_TABS, false);
		pickTabs(firstPage.document).click();
		const secondPage = initWithDom(OPEN_BOOKMARK, false, firstPage.storage);
		expect(secondPage.document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(
			false,
		);
	});

	it("keeps a swapped-in bookmark collapsed once dismissed", () => {
		const { document, triggerSwap } = initWithDom(BOOKMARK_WITH_TABS, false);
		pickTabs(document).click();
		document.body.innerHTML = OPEN_BOOKMARK;
		triggerSwap(document.body);
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(false);
	});

	it("treats a throwing storage read as not dismissed and applies the viewport default", () => {
		const throwingRead: BookmarkStorage = {
			getItem: () => {
				throw new Error("access denied");
			},
			setItem: () => {},
		};
		const { document } = initWithDom(CLOSED_BOOKMARK, false, throwingRead);
		expect(document.querySelector(".crawl-bookmark")?.hasAttribute("open")).toBe(true);
	});

	it("swallows a throwing storage write and still collapses the capsule", () => {
		const throwingWrite: BookmarkStorage = {
			getItem: () => null,
			setItem: () => {
				throw new Error("quota");
			},
		};
		const { document } = initWithDom(BOOKMARK_WITH_TABS, false, throwingWrite);
		const bookmark = document.querySelector(".crawl-bookmark");
		assert(bookmark, "the bookmark must be present");
		expect(() => pickTabs(document).click()).not.toThrow();
		expect(bookmark.hasAttribute("open")).toBe(false);
	});
});
