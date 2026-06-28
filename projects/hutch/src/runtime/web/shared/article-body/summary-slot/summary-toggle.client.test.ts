import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initSummaryToggleBeacon } from "./summary-toggle.client";

const TOGGLE_URL = "/queue/abc/summary-toggle";

function readySummary(toggleUrlAttr: string): string {
	return `<div data-test-reader-summary><details class="article-body__summary"${toggleUrlAttr}><summary>Summary (TL;DR)</summary><pre>TL;DR</pre></details></div>`;
}

function makeDom(bodyHtml: string): { document: Document; toggle: (el: Element) => void } {
	const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
	return {
		document: dom.window.document,
		toggle: (el) => el.dispatchEvent(new dom.window.Event("toggle")),
	};
}

/** Captures beacon URLs and lets a test fire a swap event on demand, mirroring
 * the htmx:afterSwap wiring the bundle footer installs. */
function createHarness(doc: Document) {
	const beacons: string[] = [];
	let swapListener: (() => void) | null = null;
	initSummaryToggleBeacon({
		document: doc,
		sendBeacon: (url) => beacons.push(url),
		addSwapListener: (listener) => {
			swapListener = listener;
		},
	});
	return {
		beacons,
		fireSwap(): void {
			assert(swapListener, "a swap listener must be registered");
			swapListener();
		},
	};
}

function details(doc: Document): HTMLDetailsElement {
	const el = doc.querySelector<HTMLDetailsElement>("details[data-summary-toggle-url]");
	assert(el, "details with tracking URL must exist in fixture");
	return el;
}

describe("initSummaryToggleBeacon", () => {
	it("is a no-op when no <details> carries data-summary-toggle-url (public/admin readers)", () => {
		const dom = makeDom(readySummary(""));
		const harness = createHarness(dom.document);

		const plainDetails = dom.document.querySelector<HTMLDetailsElement>("details");
		assert(plainDetails, "a plain details still exists");
		plainDetails.open = true;
		dom.toggle(plainDetails);

		assert.equal(harness.beacons.length, 0);
	});

	it("beacons ?state=open when the summary is expanded", () => {
		const dom = makeDom(readySummary(` data-summary-toggle-url="${TOGGLE_URL}"`));
		const harness = createHarness(dom.document);

		const el = details(dom.document);
		el.open = true;
		dom.toggle(el);

		assert.deepEqual(harness.beacons, [`${TOGGLE_URL}?state=open`]);
	});

	it("beacons ?state=closed when the summary is collapsed", () => {
		const dom = makeDom(readySummary(` data-summary-toggle-url="${TOGGLE_URL}" open`));
		const harness = createHarness(dom.document);

		const el = details(dom.document);
		el.open = false;
		dom.toggle(el);

		assert.deepEqual(harness.beacons, [`${TOGGLE_URL}?state=closed`]);
	});

	it("does not double-bind the same element across swap events (one beacon per toggle)", () => {
		const dom = makeDom(readySummary(` data-summary-toggle-url="${TOGGLE_URL}"`));
		const harness = createHarness(dom.document);

		harness.fireSwap(); // re-scan; the existing element is already bound

		const el = details(dom.document);
		el.open = true;
		dom.toggle(el);

		assert.equal(harness.beacons.length, 1, "exactly one beacon, not one per bind pass");
	});

	it("binds a fresh <details> spliced in by a poll response after a swap", () => {
		const dom = makeDom(readySummary(` data-summary-toggle-url="${TOGGLE_URL}"`));
		const harness = createHarness(dom.document);

		// Simulate htmx replacing the summary slot with a new (unbound) details.
		const slot = dom.document.querySelector("[data-test-reader-summary]");
		assert(slot);
		slot.innerHTML = `<details class="article-body__summary" data-summary-toggle-url="${TOGGLE_URL}"><summary>Summary (TL;DR)</summary><pre>TL;DR</pre></details>`;
		harness.fireSwap();

		const el = details(dom.document);
		el.open = true;
		dom.toggle(el);

		assert.deepEqual(harness.beacons, [`${TOGGLE_URL}?state=open`]);
	});
});
