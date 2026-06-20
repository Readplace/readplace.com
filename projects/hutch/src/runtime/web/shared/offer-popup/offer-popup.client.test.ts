import assert from "node:assert/strict";
import { fireEvent } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { serializeState } from "./offer-popup.logic";
import { initOfferPopup } from "./offer-popup.client";

const STORAGE_KEY = "readplace.offer-popup.v1";
const OPEN_CLASS = "offer-popup--open";

const FIXTURE = `<!DOCTYPE html><html><body>
  <main data-test-page-behind>Page content behind the modal</main>
  <div class="offer-popup" data-offer-popup data-offer-stage="offer">
    <div class="offer-popup__panel">
      <section class="offer-popup__view offer-popup__view--offer">
        <button type="button" data-offer-action="close" data-test-offer-close>×</button>
        <a href="/account" data-test-offer-cta>Lock in</a>
      </section>
      <section class="offer-popup__view offer-popup__view--confirm-first">
        <button type="button" data-offer-action="keep" data-test-offer-keep>Keep my spot</button>
        <button type="button" data-offer-action="confirm" data-test-offer-confirm>Close anyway</button>
      </section>
      <section class="offer-popup__view offer-popup__view--confirm-second">
        <button type="button" data-offer-action="keep" data-test-offer-keep-2>Keep my price</button>
        <button type="button" data-offer-action="dismiss" data-test-offer-dismiss>Close and lose it</button>
      </section>
    </div>
  </div>
</body></html>`;

function createDom(search: string) {
	const dom = new JSDOM(FIXTURE, { url: `https://readplace.com/queue${search}` });
	return { window: dom.window, document: dom.window.document };
}

function popup(doc: Document): HTMLElement {
	const el = doc.querySelector<HTMLElement>("[data-offer-popup]");
	assert(el, "popup root must exist in fixture");
	return el;
}

function click(doc: Document, testAttr: string): void {
	const el = doc.querySelector<HTMLElement>(`[${testAttr}]`);
	assert(el, `element [${testAttr}] must exist in fixture`);
	fireEvent.click(el);
}

describe("initOfferPopup — missing root", () => {
	it("throws a descriptive error when the popup is absent", () => {
		const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
			url: "https://readplace.com/queue",
		});
		expect(() =>
			initOfferPopup({
				document: dom.window.document,
				storage: dom.window.localStorage,
				location: { search: "" },
			}),
		).toThrow(/missing element \[data-offer-popup\]/);
	});
});

describe("initOfferPopup — dismissal gating", () => {
	it("opens immediately when the device carries no stored dismissal (the server already gated eligibility)", () => {
		const { window, document } = createDom("");

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
		}).attach();

		const root = popup(document);
		expect(root.classList.contains(OPEN_CLASS)).toBe(true);
		expect(root.getAttribute("data-offer-stage")).toBe("offer");
	});

	it("does not open once the reader has closed it on this device", () => {
		const { window, document } = createDom("");
		window.localStorage.setItem(STORAGE_KEY, serializeState({ closed: true }));

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
		}).attach();

		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(false);
	});
});

describe("initOfferPopup — preview override", () => {
	it("shows immediately without persisting any state", () => {
		const { window, document } = createDom("?offer-preview=1");

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
		}).attach();

		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(true);
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
	});
});

describe("initOfferPopup — double-confirmation close flow", () => {
	function shownPreviewDom() {
		const { window, document } = createDom("?offer-preview=1");
		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
		}).attach();
		return { window, document };
	}

	it("moves from the offer to the first confirmation when the reader closes", () => {
		const { document } = shownPreviewDom();
		click(document, "data-test-offer-close");
		expect(popup(document).getAttribute("data-offer-stage")).toBe("confirm-first");
	});

	it("moves to the second confirmation when the reader insists on closing", () => {
		const { document } = shownPreviewDom();
		click(document, "data-test-offer-close");
		click(document, "data-test-offer-confirm");
		expect(popup(document).getAttribute("data-offer-stage")).toBe("confirm-second");
	});

	it("returns to the offer when the reader keeps their spot", () => {
		const { document } = shownPreviewDom();
		click(document, "data-test-offer-close");
		click(document, "data-test-offer-confirm");
		click(document, "data-test-offer-keep-2");
		expect(popup(document).getAttribute("data-offer-stage")).toBe("offer");
		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(true);
	});

	it("closes the popup only after both confirmations", () => {
		const { document } = shownPreviewDom();
		click(document, "data-test-offer-close");
		click(document, "data-test-offer-confirm");
		click(document, "data-test-offer-dismiss");
		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("persists the closed flag when dismissed outside preview so it never returns", () => {
		const { window, document } = createDom("");
		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
		}).attach();

		click(document, "data-test-offer-dismiss");

		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(false);
		const stored = window.localStorage.getItem(STORAGE_KEY);
		assert(stored, "state must be persisted");
		expect(JSON.parse(stored).closed).toBe(true);
	});

	it("does not persist the closed flag when dismissed in preview", () => {
		const { window, document } = shownPreviewDom();
		click(document, "data-test-offer-dismiss");
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
	});
});

describe("initOfferPopup — stage labelling", () => {
	it("labels the dialog by the visible heading of each stage", () => {
		const { window, document } = createDom("?offer-preview=1");
		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
		}).attach();
		const root = popup(document);

		assert.equal(root.getAttribute("aria-labelledby"), "offer-popup-title-offer");

		click(document, "data-test-offer-close");
		assert.equal(
			root.getAttribute("aria-labelledby"),
			"offer-popup-title-confirm-first",
		);

		click(document, "data-test-offer-confirm");
		assert.equal(
			root.getAttribute("aria-labelledby"),
			"offer-popup-title-confirm-second",
		);

		click(document, "data-test-offer-keep-2");
		assert.equal(root.getAttribute("aria-labelledby"), "offer-popup-title-offer");
	});
});

describe("initOfferPopup — background inertness", () => {
	function behind(doc: Document): Element {
		const el = doc.querySelector("[data-test-page-behind]");
		assert(el, "page content behind the modal must exist in the fixture");
		return el;
	}

	it("marks sibling page content inert and aria-hidden while open, sparing the popup itself", () => {
		const { window, document } = createDom("?offer-preview=1");
		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
		}).attach();

		const el = behind(document);
		assert.equal(el.getAttribute("inert"), "");
		assert.equal(el.getAttribute("aria-hidden"), "true");

		const root = popup(document);
		assert.equal(root.hasAttribute("inert"), false);
		assert.equal(root.hasAttribute("aria-hidden"), false);
	});

	it("restores the background once the popup is dismissed", () => {
		const { window, document } = createDom("");
		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
		}).attach();

		click(document, "data-test-offer-dismiss");

		const el = behind(document);
		assert.equal(el.hasAttribute("inert"), false);
		assert.equal(el.hasAttribute("aria-hidden"), false);
	});
});

describe("initOfferPopup — storage failures", () => {
	it("treats a throwing getItem as a fresh, undismissed device and still opens", () => {
		const { document } = createDom("");
		const storage = {
			getItem: jest.fn((): string | null => {
				throw new Error("access denied");
			}),
			setItem: jest.fn(),
		};

		expect(() =>
			initOfferPopup({
				document,
				storage,
				location: { search: "" },
			}).attach(),
		).not.toThrow();
		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(true);
	});

	it("swallows a throwing setItem when persisting the dismissal", () => {
		const { document } = createDom("");
		const storage = {
			getItem: jest.fn((): string | null => null),
			setItem: jest.fn((_k: string, _v: string): void => {
				throw new Error("quota");
			}),
		};

		initOfferPopup({
			document,
			storage,
			location: { search: "" },
		}).attach();

		expect(() => click(document, "data-test-offer-dismiss")).not.toThrow();
		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(false);
	});
});

describe("initOfferPopup — focus management", () => {
	function openPreview() {
		const { window, document } = createDom("?offer-preview=1");
		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
		}).attach();
		return { window, document };
	}

	function control(doc: Document, testAttr: string): HTMLElement {
		const el = doc.querySelector<HTMLElement>(`[${testAttr}]`);
		assert(el, `element [${testAttr}] must exist in fixture`);
		return el;
	}

	it("moves focus to the first control when the dialog opens", () => {
		const { document } = openPreview();
		assert.equal(document.activeElement, control(document, "data-test-offer-close"));
	});

	it("moves focus into each step as the stage changes", () => {
		const { document } = openPreview();
		click(document, "data-test-offer-close");
		assert.equal(document.activeElement, control(document, "data-test-offer-keep"));
	});

	it("wraps Tab from the last control back to the first", () => {
		const { document } = openPreview();
		const cta = control(document, "data-test-offer-cta");
		cta.focus();
		const notPrevented = fireEvent.keyDown(cta, { key: "Tab" });
		assert.equal(document.activeElement, control(document, "data-test-offer-close"));
		assert.equal(notPrevented, false);
	});

	it("wraps Shift+Tab from the first control to the last", () => {
		const { document } = openPreview();
		const close = control(document, "data-test-offer-close");
		close.focus();
		const notPrevented = fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
		assert.equal(document.activeElement, control(document, "data-test-offer-cta"));
		assert.equal(notPrevented, false);
	});

	it("lets Tab fall through when focus is not on the last control", () => {
		const { document } = openPreview();
		const close = control(document, "data-test-offer-close");
		close.focus();
		const notPrevented = fireEvent.keyDown(close, { key: "Tab" });
		assert.equal(document.activeElement, close);
		assert.equal(notPrevented, true);
	});

	it("lets Shift+Tab fall through when focus is not on the first control", () => {
		const { document } = openPreview();
		const cta = control(document, "data-test-offer-cta");
		cta.focus();
		const notPrevented = fireEvent.keyDown(cta, { key: "Tab", shiftKey: true });
		assert.equal(document.activeElement, cta);
		assert.equal(notPrevented, true);
	});

	it("ignores keys other than Tab", () => {
		const { document } = openPreview();
		const close = control(document, "data-test-offer-close");
		close.focus();
		fireEvent.keyDown(close, { key: "Enter" });
		assert.equal(document.activeElement, close);
	});

	it("restores focus to the previously focused control when dismissed", () => {
		const { window, document } = createDom("?offer-preview=1");
		const opener = document.createElement("button");
		document.body.appendChild(opener);
		opener.focus();

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
		}).attach();

		assert.notEqual(document.activeElement, opener);

		click(document, "data-test-offer-close");
		click(document, "data-test-offer-confirm");
		click(document, "data-test-offer-dismiss");

		assert.equal(document.activeElement, opener);
	});
});
