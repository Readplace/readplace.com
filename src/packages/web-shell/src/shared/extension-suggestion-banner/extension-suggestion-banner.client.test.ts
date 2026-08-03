import assert from "node:assert/strict";
import { fireEvent } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { initExtensionSuggestionBanner } from "./extension-suggestion-banner.client";

const STORAGE_KEY = "readplace.extension-suggestion-dismissed";
const VISIBLE_CLASS = "extension-suggestion-banner--visible";

/** The shell wires this to `htmx:afterSwap`; tests that do not exercise a
 * boosted swap pass a listener that is never invoked. */
const noSwap = (): void => {};

function buildFixture(showAttr: "true" | "false", mainMarker?: "true" | "false"): string {
	const main = mainMarker === undefined ? "" : `<main data-extension-suggestion="${mainMarker}"></main>`;
	return `<!DOCTYPE html><html><body>
		<div class="extension-suggestion-banner" data-show-extension-suggestion="${showAttr}">
			<span class="extension-suggestion-banner__message">Tip</span>
			<a class="extension-suggestion-banner__cta" href="/install">Get the extension</a>
			<button type="button" class="extension-suggestion-banner__close" data-extension-suggestion-close>
				<span aria-hidden="true">&times;</span>
			</button>
		</div>
		${main}
	</body></html>`;
}

function createDom(showAttr: "true" | "false", mainMarker?: "true" | "false") {
	const dom = new JSDOM(buildFixture(showAttr, mainMarker), {
		url: "https://readplace.com/queue",
	});
	return { window: dom.window, document: dom.window.document };
}

function banner(doc: Document): HTMLElement {
	const el = doc.querySelector<HTMLElement>(".extension-suggestion-banner");
	assert(el, "banner element must exist in fixture");
	return el;
}

function closeBtn(doc: Document): HTMLElement {
	const el = doc.querySelector<HTMLElement>("[data-extension-suggestion-close]");
	assert(el, "close button must exist in fixture");
	return el;
}

describe("initExtensionSuggestionBanner — attach", () => {
	it("adds the visible class when show=true and the dismiss flag is not set", () => {
		const { window, document } = createDom("true");

		initExtensionSuggestionBanner({
			document,
			storage: window.localStorage,
			addSwapListener: noSwap,
		}).attach();

		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(true);
	});

	it("leaves the banner hidden when show=false", () => {
		const { window, document } = createDom("false");

		initExtensionSuggestionBanner({
			document,
			storage: window.localStorage,
			addSwapListener: noSwap,
		}).attach();

		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(false);
	});

	it("leaves the banner hidden when the dismiss flag is already set", () => {
		const { window, document } = createDom("true");
		window.localStorage.setItem(STORAGE_KEY, "1");

		initExtensionSuggestionBanner({
			document,
			storage: window.localStorage,
			addSwapListener: noSwap,
		}).attach();

		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(false);
	});
});

describe("initExtensionSuggestionBanner — boosted swap", () => {
	/** On a full load the banner and <main> always agree — they come from the
	 * same render. A boosted swap is what makes them diverge: <main> is replaced
	 * with the destination's, the banner is not. `arrive` reproduces that. */
	function attachCapturingSwap(showAttr: "true" | "false", mainMarker?: "true" | "false") {
		const { window, document } = createDom(showAttr, mainMarker);
		let onSwap = (): void => {};
		initExtensionSuggestionBanner({
			document,
			storage: window.localStorage,
			addSwapListener: (cb) => {
				onSwap = cb;
			},
		}).attach();
		function arrive(destination: "true" | "false"): void {
			const main = document.querySelector<HTMLElement>("main");
			assert(main, "fixture must have a <main> to swap");
			main.dataset.extensionSuggestion = destination;
			onSwap();
		}
		return { window, document, arrive, swap: () => onSwap() };
	}

	it("reveals the banner when the swapped-in page says to show it", () => {
		const { document, arrive } = attachCapturingSwap("false", "false");
		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(false);

		arrive("true");

		expect(banner(document).dataset.showExtensionSuggestion).toBe("true");
		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(true);
	});

	it("hides the banner when the swapped-in page says not to show it", () => {
		const { document, arrive } = attachCapturingSwap("true", "true");
		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(true);

		arrive("false");

		expect(banner(document).dataset.showExtensionSuggestion).toBe("false");
		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(false);
	});

	it("keeps the banner dismissed across a swap that would otherwise show it", () => {
		const { window, document, arrive } = attachCapturingSwap("false", "false");
		window.localStorage.setItem(STORAGE_KEY, "1");

		arrive("true");

		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(false);
	});

	it("keeps the server-rendered answer when the swapped-in markup carries no marker", () => {
		const { document, swap } = attachCapturingSwap("true");

		swap();

		expect(banner(document).dataset.showExtensionSuggestion).toBe("true");
		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(true);
	});
});

describe("initExtensionSuggestionBanner — dismiss", () => {
	it("removes the visible class and persists the dismiss flag when the close button is clicked", () => {
		const { window, document } = createDom("true");

		initExtensionSuggestionBanner({
			document,
			storage: window.localStorage,
			addSwapListener: noSwap,
		}).attach();
		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(true);

		fireEvent.click(closeBtn(document));

		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(false);
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
	});

	it("keeps the banner hidden on a subsequent attach after dismissal", () => {
		const { window, document } = createDom("true");

		initExtensionSuggestionBanner({
			document,
			storage: window.localStorage,
			addSwapListener: noSwap,
		}).attach();
		fireEvent.click(closeBtn(document));

		// Simulate a second page load by re-attaching with the same storage.
		const { document: doc2 } = createDom("true");
		initExtensionSuggestionBanner({
			document: doc2,
			storage: window.localStorage,
			addSwapListener: noSwap,
		}).attach();

		expect(banner(doc2).classList.contains(VISIBLE_CLASS)).toBe(false);
	});
});

describe("initExtensionSuggestionBanner — storage failures", () => {
	it("treats a throwing getItem as not dismissed and still shows the banner", () => {
		const { document } = createDom("true");
		const storage = {
			getItem: jest.fn((): string | null => {
				throw new Error("access denied");
			}),
			setItem: jest.fn(),
		};

		initExtensionSuggestionBanner({ document, storage, addSwapListener: noSwap }).attach();

		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(true);
	});

	it("swallows a throwing setItem when the user dismisses", () => {
		const { document } = createDom("true");
		const storage = {
			getItem: jest.fn((): string | null => null),
			setItem: jest.fn((_k: string, _v: string): void => {
				throw new Error("quota");
			}),
		};

		initExtensionSuggestionBanner({ document, storage, addSwapListener: noSwap }).attach();

		expect(() => fireEvent.click(closeBtn(document))).not.toThrow();
		expect(banner(document).classList.contains(VISIBLE_CLASS)).toBe(false);
	});
});

describe("initExtensionSuggestionBanner — missing elements", () => {
	it("throws a descriptive error when the banner element is absent", () => {
		const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
			url: "https://readplace.com/",
		});

		expect(() =>
			initExtensionSuggestionBanner({
				document: dom.window.document,
				storage: dom.window.localStorage,
				addSwapListener: noSwap,
			}),
		).toThrow(/missing element \.extension-suggestion-banner/);
	});

	it("throws a descriptive error when the close button is absent", () => {
		const dom = new JSDOM(
			`<!DOCTYPE html><html><body>
				<div class="extension-suggestion-banner" data-show-extension-suggestion="true"></div>
			</body></html>`,
			{ url: "https://readplace.com/" },
		);

		const ctrl = initExtensionSuggestionBanner({
			document: dom.window.document,
			storage: dom.window.localStorage,
			addSwapListener: noSwap,
		});

		expect(() => ctrl.attach()).toThrow(
			/missing element \[data-extension-suggestion-close\]/,
		);
	});
});
