import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initCaptureFailedRelay } from "./capture-failed-relay.client";

const GIVE_UP_NOTICE =
	'<section id="article-body-reader-notice" hx-get="/queue/a/reader?poll=1&captureSince=0&captureGaveUp=1" hx-trigger="readplace-capture-failed from:document"></section>';
const OFFERED_NOTICE =
	'<section id="article-body-reader-notice" hx-trigger="readplace-capture-started from:document"><button type="button" data-reader-capture>Capture it here</button></section>';

function createHarness(noticeHtml: string) {
	const dom = new JSDOM(`<!doctype html><html><body><main>${noticeHtml}</main></body></html>`);
	const document = dom.window.document;
	let heard = 0;
	let relayed = 0;
	document.addEventListener("readplace-capture-failed", () => {
		const notice = document.querySelector('[hx-trigger^="readplace-capture-failed"]');
		if (notice && notice === loaded) heard += 1;
	});
	let loaded: Element | null = null;

	initCaptureFailedRelay({
		document,
		isCaptureControl: (target) => target instanceof dom.window.Element && target.closest("[data-reader-capture]") !== null,
		dispatchCaptureFailed: () => {
			relayed += 1;
			document.dispatchEvent(new dom.window.Event("readplace-capture-failed"));
		},
	});

	function swapNotice(html: string): Element {
		const main = document.querySelector("main");
		assert(main, "the harness page holds a <main>");
		main.innerHTML = html;
		const notice = main.firstElementChild;
		assert(notice, "the swapped html holds a notice");
		return notice;
	}

	return {
		send: (type: string) => document.dispatchEvent(new dom.window.Event(type)),
		swapNotice,
		htmxLoaded(target: Element) {
			if (target.matches('[hx-trigger^="readplace-capture-failed"]') || target.querySelector('[hx-trigger^="readplace-capture-failed"]')) {
				loaded = document.querySelector('[hx-trigger^="readplace-capture-failed"]');
			}
			target.dispatchEvent(new dom.window.CustomEvent("htmx:load", { bubbles: true }));
		},
		tapCapture() {
			const control = document.querySelector("[data-reader-capture]");
			assert(control, "the offered notice holds the capture control");
			control.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		},
		clickOutsideCapture() {
			document.body.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
		},
		appendElsewhere: () => document.body.appendChild(document.createElement("div")),
		body: () => document.body,
		heard: () => heard,
		relayed: () => relayed,
	};
}

describe("initCaptureFailedRelay", () => {
	it("a failure reported once htmx has loaded the give-up notice is left to htmx", () => {
		const harness = createHarness(GIVE_UP_NOTICE);
		harness.htmxLoaded(harness.body());

		harness.send("readplace-capture-failed");

		assert.equal(harness.relayed(), 0);
		assert.equal(harness.heard(), 1);
	});

	it("a failure reported while the kick-off is still in flight is sent again once htmx loads the give-up notice", () => {
		const harness = createHarness(OFFERED_NOTICE);
		harness.htmxLoaded(harness.body());
		harness.tapCapture();

		harness.send("readplace-capture-failed");
		assert.equal(harness.heard(), 0);
		harness.htmxLoaded(harness.swapNotice(GIVE_UP_NOTICE));

		assert.equal(harness.relayed(), 1);
		assert.equal(harness.heard(), 1);
	});

	it("a failure reported before htmx loads a give-up notice swapped in by a poll waits for that notice", () => {
		const harness = createHarness(GIVE_UP_NOTICE);
		harness.htmxLoaded(harness.body());
		const swapped = harness.swapNotice(GIVE_UP_NOTICE);

		harness.send("readplace-capture-failed");
		harness.htmxLoaded(harness.appendElsewhere());
		assert.equal(harness.relayed(), 0);
		harness.htmxLoaded(swapped);

		assert.equal(harness.relayed(), 1);
		assert.equal(harness.heard(), 1);
	});

	it("a held failure is dropped when the reader taps capture again, so it cannot end the next copy", () => {
		const harness = createHarness(OFFERED_NOTICE);
		harness.send("readplace-capture-failed");

		harness.tapCapture();
		harness.htmxLoaded(harness.swapNotice(GIVE_UP_NOTICE));

		assert.equal(harness.relayed(), 0);
	});

	it("a held failure is dropped when a device starts a new capture", () => {
		const harness = createHarness(OFFERED_NOTICE);
		harness.send("readplace-capture-failed");

		harness.send("readplace-capture-started");
		harness.htmxLoaded(harness.swapNotice(GIVE_UP_NOTICE));

		assert.equal(harness.relayed(), 0);
	});

	it("a click outside the capture control keeps a held failure", () => {
		const harness = createHarness(OFFERED_NOTICE);
		harness.send("readplace-capture-failed");

		harness.clickOutsideCapture();
		harness.htmxLoaded(harness.swapNotice(GIVE_UP_NOTICE));

		assert.equal(harness.relayed(), 1);
	});
});
