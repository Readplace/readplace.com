import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initQueueFocus } from "./queue-focus.client";

interface Harness {
	document: Document;
	fireBeforeSwap: (target: Element) => void;
	fireAfterSettle: () => void;
}

/** Wires initQueueFocus to a jsdom document, capturing the htmx listeners so a
 * test can drive a beforeSwap → (DOM mutation) → afterSettle cycle by hand. */
function harness(bodyHtml: string): Harness {
	const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
	const document = dom.window.document;
	let beforeSwap: ((target: Element) => void) | undefined;
	let afterSettle: (() => void) | undefined;
	initQueueFocus({
		document,
		addBeforeSwapListener: (listener) => {
			beforeSwap = listener;
		},
		addAfterSettleListener: (listener) => {
			afterSettle = listener;
		},
	});
	assert(beforeSwap, "beforeSwap listener must be registered");
	assert(afterSettle, "afterSettle listener must be registered");
	return {
		document,
		fireBeforeSwap: beforeSwap,
		fireAfterSettle: afterSettle,
	};
}

const LIST = (cards: string) => `
	<input class="queue__save-input" type="url">
	<div class="queue__list">${cards}</div>
`;

const CARD = (id: string) =>
	`<div class="queue-article" id="${id}"><button class="queue-article__action-btn" id="btn-${id}">act</button></div>`;

function focus(document: Document, selector: string): void {
	const el = document.querySelector<HTMLElement>(selector);
	assert(el, `fixture must contain ${selector}`);
	el.focus();
}

function activeId(document: Document): string | null {
	return document.activeElement?.id ?? null;
}

describe("initQueueFocus", () => {
	it("moves focus to the toast Undo after a focused status card is removed", () => {
		const h = harness(LIST(CARD("c1") + CARD("c2")));
		focus(h.document, "#btn-c1");
		const c1 = h.document.getElementById("c1");
		assert(c1);

		h.fireBeforeSwap(c1);
		c1.remove();
		// The status response OOB-mounts the toast before settle.
		h.document.querySelector(".queue__list")?.insertAdjacentHTML(
			"beforebegin",
			`<div class="toast"><button class="toast__action" id="undo">Undo</button></div>`,
		);
		h.fireAfterSettle();

		expect(activeId(h.document)).toBe("undo");
	});

	it("falls to the adjacent (next) card when a focused delete card is removed and there is no toast", () => {
		const h = harness(LIST(CARD("c1") + CARD("c2")));
		focus(h.document, "#btn-c1");
		const c1 = h.document.getElementById("c1");
		assert(c1);

		h.fireBeforeSwap(c1);
		c1.remove();
		h.fireAfterSettle();

		expect(activeId(h.document)).toBe("btn-c2");
	});

	it("falls to the previous card when the removed focused card was the last in the list", () => {
		const h = harness(LIST(CARD("c1") + CARD("c2")));
		focus(h.document, "#btn-c2");
		const c2 = h.document.getElementById("c2");
		assert(c2);

		h.fireBeforeSwap(c2);
		c2.remove();
		h.fireAfterSettle();

		expect(activeId(h.document)).toBe("btn-c1");
	});

	it("falls to the save input when the removed card had no sibling card", () => {
		const h = harness(LIST(CARD("only")));
		focus(h.document, "#btn-only");
		const only = h.document.getElementById("only");
		assert(only);

		h.fireBeforeSwap(only);
		only.remove();
		h.fireAfterSettle();

		expect(h.document.activeElement).toBe(h.document.querySelector(".queue__save-input"));
	});

	it("falls to the save input when the remembered adjacent card was itself replaced (detached)", () => {
		const h = harness(LIST(CARD("c1") + CARD("c2")));
		focus(h.document, "#btn-c1");
		const c1 = h.document.getElementById("c1");
		const c2 = h.document.getElementById("c2");
		assert(c1 && c2);

		h.fireBeforeSwap(c1);
		// A full-listing fallback replaces the whole list, detaching the remembered
		// adjacent reference.
		c1.remove();
		c2.remove();
		h.fireAfterSettle();

		expect(h.document.activeElement).toBe(h.document.querySelector(".queue__save-input"));
	});

	it("falls to the save input when the adjacent card carries no action button", () => {
		const h = harness(
			LIST(
				`<div class="queue-article" id="c1"><button class="queue-article__action-btn" id="btn-c1">act</button></div>` +
					`<div class="queue-article" id="c2"></div>`,
			),
		);
		focus(h.document, "#btn-c1");
		const c1 = h.document.getElementById("c1");
		assert(c1);

		h.fireBeforeSwap(c1);
		c1.remove();
		h.fireAfterSettle();

		expect(h.document.activeElement).toBe(h.document.querySelector(".queue__save-input"));
	});

	it("does nothing when nothing focusable remains (no toast, no adjacent, no save input)", () => {
		const h = harness(`<div class="queue__list">${CARD("only")}</div>`);
		focus(h.document, "#btn-only");
		const only = h.document.getElementById("only");
		assert(only);

		h.fireBeforeSwap(only);
		only.remove();
		h.fireAfterSettle();

		// activeElement falls back to <body> once the focused button is gone.
		expect(h.document.activeElement).toBe(h.document.body);
	});

	it("leaves focus alone when it was outside the swapped card (mouse user)", () => {
		const h = harness(LIST(CARD("c1") + CARD("c2")));
		focus(h.document, ".queue__save-input");
		const c1 = h.document.getElementById("c1");
		assert(c1);

		h.fireBeforeSwap(c1);
		c1.remove();
		h.fireAfterSettle();

		expect(h.document.activeElement).toBe(h.document.querySelector(".queue__save-input"));
	});

	it("ignores a swap whose target is not a queue card (counts / poll swaps)", () => {
		const h = harness(`${LIST(CARD("c1"))}<span id="queue-counts"></span>`);
		focus(h.document, "#btn-c1");
		const counts = h.document.getElementById("queue-counts");
		assert(counts);

		h.fireBeforeSwap(counts);
		h.fireAfterSettle();

		// Focus stays put: the settle handler was never armed.
		expect(activeId(h.document)).toBe("btn-c1");
	});
});
