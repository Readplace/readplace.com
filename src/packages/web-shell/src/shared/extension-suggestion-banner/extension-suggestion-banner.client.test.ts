import assert from "node:assert/strict";
import { fireEvent } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { initExtensionSuggestionBanner } from "./extension-suggestion-banner.client";

const STORAGE_KEY = "readplace.extension-suggestion-dismissed";
const VISIBLE_CLASS = "extension-suggestion-banner--visible";

interface FakeStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function fixture(showAttr: "true" | "false"): string {
	return `<div id="extension-suggestion-banner" class="extension-suggestion-banner" data-show-extension-suggestion="${showAttr}">
			<span class="extension-suggestion-banner__message">Tip</span>
			<a class="extension-suggestion-banner__cta" href="/install">Get the extension</a>
			<button type="button" class="extension-suggestion-banner__close" data-extension-suggestion-close>
				<span aria-hidden="true">&times;</span>
			</button>
		</div>`;
}

function createHarness(showAttr: "true" | "false", storageOverride?: FakeStorage) {
	const dom = new JSDOM(
		`<!DOCTYPE html><html><body>${fixture(showAttr)}</body></html>`,
		{ url: "https://readplace.com/queue" },
	);
	const document = dom.window.document;
	const storage: FakeStorage = storageOverride ?? dom.window.localStorage;
	const listeners: Array<() => void> = [];
	const controller = initExtensionSuggestionBanner({
		document,
		storage,
		addSwapListener: (cb) => {
			listeners.push(cb);
		},
	});
	function banner(): HTMLElement {
		const el = document.querySelector<HTMLElement>(".extension-suggestion-banner");
		assert(el, "banner element must exist");
		return el;
	}
	function closeBtn(): HTMLElement {
		const el = document.querySelector<HTMLElement>("[data-extension-suggestion-close]");
		assert(el, "close button must exist");
		return el;
	}
	return {
		document,
		storage,
		banner,
		closeBtn,
		isVisible: (): boolean => banner().classList.contains(VISIBLE_CLASS),
		attach: (): void => controller.attach(),
		swapIn(next: "true" | "false"): void {
			banner().outerHTML = fixture(next);
			listeners.forEach((l) => {
				l();
			});
		},
	};
}

describe("initExtensionSuggestionBanner — attach", () => {
	it("adds the visible class when show=true and the dismiss flag is not set", () => {
		const h = createHarness("true");
		h.attach();
		expect(h.isVisible()).toBe(true);
	});

	it("leaves the banner hidden when show=false", () => {
		const h = createHarness("false");
		h.attach();
		expect(h.isVisible()).toBe(false);
	});

	it("leaves the banner hidden when the dismiss flag is already set", () => {
		const h = createHarness("true");
		h.storage.setItem(STORAGE_KEY, "1");
		h.attach();
		expect(h.isVisible()).toBe(false);
	});
});

describe("initExtensionSuggestionBanner — dismiss", () => {
	it("removes the visible class and persists the dismiss flag when the close button is clicked", () => {
		const h = createHarness("true");
		h.attach();
		expect(h.isVisible()).toBe(true);

		fireEvent.click(h.closeBtn());

		expect(h.isVisible()).toBe(false);
		expect(h.storage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("keeps the banner hidden on a fresh page load once dismissal is persisted", () => {
		const first = createHarness("true");
		first.attach();
		fireEvent.click(first.closeBtn());

		const second = createHarness("true", first.storage);
		second.attach();

		expect(second.isVisible()).toBe(false);
	});

	it("does not dismiss when a click lands outside the close button", () => {
		const h = createHarness("true");
		h.attach();
		const message = h.document.querySelector<HTMLElement>(
			".extension-suggestion-banner__message",
		);
		assert(message, "message element must exist");

		fireEvent.click(message);

		expect(h.isVisible()).toBe(true);
		expect(h.storage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("ignores a click whose target is not an element", () => {
		const h = createHarness("true");
		h.attach();

		fireEvent.click(h.document);

		expect(h.isVisible()).toBe(true);
	});
});

describe("initExtensionSuggestionBanner — storage failures", () => {
	it("treats a throwing getItem as not dismissed and still shows the banner", () => {
		const storage: FakeStorage = {
			getItem: jest.fn((): string | null => {
				throw new Error("access denied");
			}),
			setItem: jest.fn(),
		};
		const h = createHarness("true", storage);

		h.attach();

		expect(h.isVisible()).toBe(true);
	});

	it("swallows a throwing setItem when the user dismisses", () => {
		const storage: FakeStorage = {
			getItem: jest.fn((): string | null => null),
			setItem: jest.fn((_k: string, _v: string): void => {
				throw new Error("quota");
			}),
		};
		const h = createHarness("true", storage);
		h.attach();

		expect(() => fireEvent.click(h.closeBtn())).not.toThrow();
		expect(h.isVisible()).toBe(false);
	});
});

describe("initExtensionSuggestionBanner — missing element", () => {
	it("throws a descriptive error on attach when the banner element is absent", () => {
		const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
			url: "https://readplace.com/",
		});
		const controller = initExtensionSuggestionBanner({
			document: dom.window.document,
			storage: dom.window.localStorage,
			addSwapListener: () => {},
		});

		expect(() => controller.attach()).toThrow(
			/missing element \.extension-suggestion-banner/,
		);
	});
});

describe("initExtensionSuggestionBanner — live swap", () => {
	it("reveals a banner swapped in with show=true after a poll observes the failure", () => {
		const h = createHarness("false");
		h.attach();
		expect(h.isVisible()).toBe(false);

		h.swapIn("true");

		expect(h.isVisible()).toBe(true);
	});

	it("hides a banner swapped in with show=false", () => {
		const h = createHarness("true");
		h.attach();
		expect(h.isVisible()).toBe(true);

		h.swapIn("false");

		expect(h.isVisible()).toBe(false);
	});

	it("dismisses a swapped-in banner via the delegated close click and persists it", () => {
		const h = createHarness("false");
		h.attach();
		h.swapIn("true");
		expect(h.isVisible()).toBe(true);

		fireEvent.click(h.closeBtn());

		expect(h.isVisible()).toBe(false);
		expect(h.storage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("keeps a swapped-in banner hidden when dismissal was persisted to storage", () => {
		const first = createHarness("true");
		first.attach();
		fireEvent.click(first.closeBtn());

		const second = createHarness("false", first.storage);
		second.attach();
		second.swapIn("true");

		expect(second.isVisible()).toBe(false);
	});

	it("keeps a swapped-in banner hidden via the in-page flag when persistence failed", () => {
		const storage: FakeStorage = {
			getItem: jest.fn((): string | null => null),
			setItem: jest.fn((_k: string, _v: string): void => {
				throw new Error("quota");
			}),
		};
		const h = createHarness("true", storage);
		h.attach();
		fireEvent.click(h.closeBtn());
		expect(h.isVisible()).toBe(false);

		h.swapIn("true");

		expect(h.isVisible()).toBe(false);
	});
});
