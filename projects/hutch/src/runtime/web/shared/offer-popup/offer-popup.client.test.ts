import assert from "node:assert/strict";
import { fireEvent } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { ONE_DAY_MS, serializeState } from "./offer-popup.logic";
import { initOfferPopup } from "./offer-popup.client";

const STORAGE_KEY = "readplace.offer-popup.v1";
const OPEN_CLASS = "offer-popup--open";

const FIXTURE = `<!DOCTYPE html><html><body>
  <div class="offer-popup" data-offer-popup data-offer-stage="offer">
    <div class="offer-popup__panel">
      <section class="offer-popup__view offer-popup__view--offer">
        <button type="button" data-offer-action="close" data-test-offer-close>×</button>
        <strong data-offer-countdown data-test-offer-countdown>10:00</strong>
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

/** Captures the single interval callback so tests can advance time and drive
 * ticks deterministically without real timers. */
function createTimers() {
	let captured: (() => void) | undefined;
	const clearIntervalFn = jest.fn();
	const setIntervalFn = jest.fn((cb: () => void): number => {
		captured = cb;
		return 7;
	});
	return {
		setIntervalFn,
		clearIntervalFn,
		tick(): void {
			assert(captured, "interval callback must be registered before ticking");
			captured();
		},
	};
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
				now: () => 0,
				setIntervalFn: () => 0,
				clearIntervalFn: () => {},
			}),
		).toThrow(/missing element \[data-offer-popup\]/);
	});
});

describe("initOfferPopup — visit gating", () => {
	it("does not show on the first visit and records firstVisitAt", () => {
		const { window, document } = createDom("");
		const timers = createTimers();

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
			now: () => 5000,
			...timers,
		}).attach();

		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(false);
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
			serializeState({ firstVisitAt: 5000 }),
		);
	});

	it("does not show when the return visit is less than a day after the first", () => {
		const { window, document } = createDom("");
		window.localStorage.setItem(STORAGE_KEY, serializeState({ firstVisitAt: 1000 }));

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
			now: () => 1000 + ONE_DAY_MS - 1,
			...createTimers(),
		}).attach();

		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("shows once on a return visit at least a day later and starts the countdown", () => {
		const { window, document } = createDom("");
		window.localStorage.setItem(STORAGE_KEY, serializeState({ firstVisitAt: 1000 }));
		const now = 1000 + ONE_DAY_MS;
		const timers = createTimers();

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
			now: () => now,
			...timers,
		}).attach();

		const root = popup(document);
		expect(root.classList.contains(OPEN_CLASS)).toBe(true);
		expect(root.getAttribute("data-offer-stage")).toBe("offer");
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
			serializeState({ firstVisitAt: 1000, shownAt: now }),
		);
		expect(timers.setIntervalFn).toHaveBeenCalledTimes(1);
		expect(
			document.querySelector("[data-test-offer-countdown]")?.textContent,
		).toBe("10:00");
	});

	it("does not show again once it has already been shown on this device", () => {
		const { window, document } = createDom("");
		window.localStorage.setItem(
			STORAGE_KEY,
			serializeState({ firstVisitAt: 1000, shownAt: 2000 }),
		);

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
			now: () => 1000 + 5 * ONE_DAY_MS,
			...createTimers(),
		}).attach();

		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(false);
	});

	it("does not show again once the reader has closed it", () => {
		const { window, document } = createDom("");
		window.localStorage.setItem(
			STORAGE_KEY,
			serializeState({ firstVisitAt: 1000, closed: true }),
		);

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
			now: () => 1000 + 5 * ONE_DAY_MS,
			...createTimers(),
		}).attach();

		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(false);
	});
});

describe("initOfferPopup — preview override", () => {
	it("shows immediately without persisting any state", () => {
		const { window, document } = createDom("?offer-preview=1");
		const timers = createTimers();

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
			now: () => 0,
			...timers,
		}).attach();

		expect(popup(document).classList.contains(OPEN_CLASS)).toBe(true);
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(timers.setIntervalFn).toHaveBeenCalledTimes(1);
	});
});

describe("initOfferPopup — double-confirmation close flow", () => {
	function shownPreviewDom() {
		const { window, document } = createDom("?offer-preview=1");
		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
			now: () => 0,
			...createTimers(),
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
		window.localStorage.setItem(STORAGE_KEY, serializeState({ firstVisitAt: 1000 }));
		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "" },
			now: () => 1000 + ONE_DAY_MS,
			...createTimers(),
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

describe("initOfferPopup — countdown lifecycle", () => {
	it("counts down on each tick and stops when the window closes", () => {
		const { window, document } = createDom("?offer-preview=1");
		const timers = createTimers();
		let nowMs = 0;

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
			now: () => nowMs,
			...timers,
		}).attach();

		nowMs = 1000;
		timers.tick();
		expect(
			document.querySelector("[data-test-offer-countdown]")?.textContent,
		).toBe("09:59");

		nowMs = 10 * 60 * 1000;
		timers.tick();
		expect(
			document.querySelector("[data-test-offer-countdown]")?.textContent,
		).toBe("00:00");
		expect(timers.clearIntervalFn).toHaveBeenCalledWith(7);
	});

	it("stops ticking once the popup has been dismissed", () => {
		const { window, document } = createDom("?offer-preview=1");
		const timers = createTimers();

		initOfferPopup({
			document,
			storage: window.localStorage,
			location: { search: "?offer-preview=1" },
			now: () => 0,
			...timers,
		}).attach();

		click(document, "data-test-offer-close");
		click(document, "data-test-offer-confirm");
		click(document, "data-test-offer-dismiss");
		timers.tick();

		expect(timers.clearIntervalFn).toHaveBeenCalledWith(7);
	});
});

describe("initOfferPopup — storage failures", () => {
	it("treats a throwing getItem as a first visit and still records progress", () => {
		const { document } = createDom("");
		const setItem = jest.fn();
		const storage = {
			getItem: jest.fn((): string | null => {
				throw new Error("access denied");
			}),
			setItem,
		};

		expect(() =>
			initOfferPopup({
				document,
				storage,
				location: { search: "" },
				now: () => 5000,
				...createTimers(),
			}).attach(),
		).not.toThrow();
		expect(setItem).toHaveBeenCalledWith(
			STORAGE_KEY,
			serializeState({ firstVisitAt: 5000 }),
		);
	});

	it("swallows a throwing setItem", () => {
		const { document } = createDom("");
		const storage = {
			getItem: jest.fn((): string | null => null),
			setItem: jest.fn((_k: string, _v: string): void => {
				throw new Error("quota");
			}),
		};

		expect(() =>
			initOfferPopup({
				document,
				storage,
				location: { search: "" },
				now: () => 5000,
				...createTimers(),
			}).attach(),
		).not.toThrow();
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
			now: () => 0,
			...createTimers(),
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
			now: () => 0,
			...createTimers(),
		}).attach();

		assert.notEqual(document.activeElement, opener);

		click(document, "data-test-offer-close");
		click(document, "data-test-offer-confirm");
		click(document, "data-test-offer-dismiss");

		assert.equal(document.activeElement, opener);
	});
});
