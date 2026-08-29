import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { initSaveTip } from "./save-tip.client";

const PAGE_URL = "https://readplace.com/queue";

const OPEN_BEACON = "/save-tip/event?utm_source=save-tip&utm_medium=internal&utm_content=opened";
const DISMISS_BEACON =
	"/save-tip/event?utm_source=save-tip&utm_medium=internal&utm_content=dismissed";
const ACKNOWLEDGE_BEACON =
	"/save-tip/event?utm_source=save-tip&utm_medium=internal&utm_content=acknowledged";

function panelMarkup(beacons: boolean): string {
	return `<div class="confirm-popover" id="save-tip" popover="auto" role="dialog"${beacons ? ` data-beacon-url="${OPEN_BEACON}"` : ""}>
	<button id="close" class="confirm-popover__close" type="button"${beacons ? ` data-beacon-url="${DISMISS_BEACON}"` : ""}>Close</button>
	<div class="confirm-popover__actions">
		<button id="acknowledge" class="btn btn--primary" type="button"${beacons ? ` data-beacon-url="${ACKNOWLEDGE_BEACON}"` : ""}>Got it</button>
		<button id="proceed" class="btn btn--primary" type="button" data-save-tip-proceed>Save the link anyway</button>
		<a id="install" class="btn btn--secondary" href="/install">See better ways to save</a>
	</div>
</div>`;
}

function page(state: string, panel: string): string {
	return `<main>
	<form id="save-form" method="POST" action="/queue/save" data-save-tip="${state}">
		<input id="save-input" type="url" name="url" value="https://example.com/post">
		<button id="save" type="submit">Save</button>
	</form>
	<form id="second-form" method="GET" action="/view" data-save-tip="${state}">
		<input id="second-input" type="url" name="url">
	</form>
	<form id="other-form" method="POST" action="/queue/other">
		<input id="other-input" type="url" name="url">
		<button id="other-save" type="submit">Other</button>
	</form>
	<a id="cta" href="https://readplace.com/save?url=x" data-save-tip="${state}">Save to My Readlist</a>
	<a id="plain-cta" href="https://readplace.com/elsewhere">Elsewhere</a>
	${panel}
</main>`;
}

function createHarness(
	options: {
		state?: string;
		supportsPopover?: boolean;
		withPanel?: boolean;
		withBeacons?: boolean;
		secureTransport?: boolean;
	} = {},
) {
	const panel = options.withPanel === false ? "" : panelMarkup(options.withBeacons !== false);
	const body = page(options.state ?? "due", panel);
	const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
		url: PAGE_URL,
		virtualConsole: new VirtualConsole(),
	});
	const document = dom.window.document;
	const shown: string[] = [];
	const hidden: string[] = [];
	const navigations: string[] = [];
	const cookies: string[] = [];
	const beacons: string[] = [];

	initSaveTip({
		document,
		supportsPopover: () => options.supportsPopover !== false,
		showPopover: (panel) => {
			shown.push(panel.id);
		},
		hidePopover: (panel) => {
			hidden.push(panel.id);
		},
		navigate: (href) => {
			navigations.push(href);
		},
		isSecureTransport: () => options.secureTransport === true,
		writeCookie: (cookie) => {
			cookies.push(cookie);
		},
		sendBeacon: (url) => {
			beacons.push(url);
		},
	});

	function element(id: string): Element {
		const found = document.getElementById(id);
		assert(found, `#${id} must exist in the fixture`);
		return found;
	}

	function stateOf(id: string): string | null {
		return element(id).getAttribute("data-save-tip");
	}

	// jsdom moves focus only for real focus() calls on focusable nodes, so the
	// events a browser would emit around one are dispatched directly instead.
	function focusInto(id: string): void {
		element(id).dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
	}

	function focusOutOf(id: string): void {
		element(id).dispatchEvent(new dom.window.Event("focusout", { bubbles: true }));
	}

	// jsdom implements no PointerEvent, and the listeners read nothing off these
	// beyond their arrival, so a plain Event of the right type is faithful.
	function pointer(id: string, type: string): void {
		element(id).dispatchEvent(new dom.window.Event(type, { bubbles: true }));
	}

	function click(id: string, init: Record<string, unknown> = {}): Event {
		const event = new dom.window.MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			button: 0,
			...init,
		});
		element(id).dispatchEvent(event);
		return event;
	}

	function dispatchOnDocument(type: string): Event {
		const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
		document.dispatchEvent(event);
		return event;
	}

	return {
		document,
		element,
		stateOf,
		focusInto,
		focusOutOf,
		pointer,
		click,
		dispatchOnDocument,
		shown,
		hidden,
		navigations,
		cookies,
		beacons,
	};
}

describe("initSaveTip", () => {
	it("opens the panel when the reader tabs into the save bar", () => {
		const harness = createHarness();

		harness.focusInto("save-input");

		expect(harness.shown).toEqual(["save-tip"]);
	});

	it("records the warning as a session cookie the page itself can write", () => {
		const harness = createHarness();

		harness.focusInto("save-input");

		expect(harness.cookies).toEqual(["rp_save_tip=seen; path=/; samesite=lax"]);
	});

	it("marks the cookie Secure when the page itself was served over https", () => {
		const harness = createHarness({ secureTransport: true });

		harness.focusInto("save-input");

		expect(harness.cookies).toEqual(["rp_save_tip=seen; path=/; samesite=lax; secure"]);
	});

	it("marks every save bar on the page as warned, so none of them asks again", () => {
		const harness = createHarness();

		harness.focusInto("save-input");

		expect(harness.stateOf("save-form")).toBe("seen");
		expect(harness.stateOf("second-form")).toBe("seen");
	});

	it("waits for the click to finish before opening, so its own release cannot dismiss it", () => {
		const harness = createHarness();

		harness.pointer("save-input", "pointerdown");
		harness.focusInto("save-input");

		expect(harness.shown).toEqual([]);

		harness.pointer("save-input", "pointerup");
		harness.click("save-input");

		expect(harness.shown).toEqual(["save-tip"]);
	});

	it("opens once for a click into the box, not again on the next click", () => {
		const harness = createHarness();
		harness.pointer("save-input", "pointerdown");
		harness.focusInto("save-input");
		harness.pointer("save-input", "pointerup");
		harness.click("save-input");

		harness.click("save-input");

		expect(harness.shown).toEqual(["save-tip"]);
	});

	it("records the warning as it shows the panel, not as focus arrives", () => {
		const harness = createHarness();

		harness.pointer("save-input", "pointerdown");
		harness.focusInto("save-input");

		expect(harness.cookies).toEqual([]);

		harness.pointer("save-input", "pointerup");
		harness.click("save-input");

		expect(harness.cookies).toEqual(["rp_save_tip=seen; path=/; samesite=lax"]);
	});

	it("opens for a press that lands the click somewhere other than the box", () => {
		const harness = createHarness();

		harness.pointer("save-input", "pointerdown");
		harness.focusInto("save-input");
		harness.pointer("save-input", "pointerup");
		harness.click("save");

		expect(harness.shown).toEqual(["save-tip"]);
	});

	it("opens on a later tab-focus rather than waiting behind an earlier click", () => {
		const harness = createHarness();
		harness.pointer("other-save", "pointerdown");
		harness.pointer("other-save", "pointerup");
		harness.click("other-save");

		harness.focusInto("save-input");

		expect(harness.shown).toEqual(["save-tip"]);
	});

	it("forgets a press whose focus left the box before the click arrived", () => {
		const harness = createHarness();

		harness.pointer("save-input", "pointerdown");
		harness.focusInto("save-input");
		harness.focusOutOf("save-input");
		harness.pointer("save-input", "pointerup");
		harness.click("save-input");

		expect(harness.shown).toEqual([]);
	});

	it("forgets a press the browser cancelled instead of completing", () => {
		const harness = createHarness();

		harness.pointer("save-input", "pointerdown");
		harness.focusInto("save-input");
		harness.pointer("save-input", "pointercancel");
		harness.click("save-input");

		expect(harness.shown).toEqual([]);
	});

	it("forgets a press that never became a click once the next press begins", () => {
		const harness = createHarness();
		// A context-menu press or an off-target release ends without a click.
		harness.pointer("save-input", "pointerdown");
		harness.focusInto("save-input");
		harness.pointer("save-input", "pointerup");

		harness.pointer("other-save", "pointerdown");
		harness.pointer("other-save", "pointerup");
		harness.click("other-save");

		expect(harness.shown).toEqual([]);
		expect(harness.cookies).toEqual([]);
	});

	it("stays quiet when the panel was swapped away before the click completed", () => {
		const harness = createHarness();
		harness.pointer("save-input", "pointerdown");
		harness.focusInto("save-input");
		harness.element("save-tip").remove();
		harness.pointer("save-input", "pointerup");

		harness.click("save-input");

		expect(harness.shown).toEqual([]);
		expect(harness.cookies).toEqual([]);
	});

	it("opens at most once a page, so dismissing it does not bring it back", () => {
		const harness = createHarness();
		harness.focusInto("save-input");

		harness.focusInto("save-input");

		expect(harness.shown).toEqual(["save-tip"]);
		expect(harness.cookies).toEqual(["rp_save_tip=seen; path=/; samesite=lax"]);
	});

	it("leaves the Save button alone, since only the URL box invites a paste", () => {
		const harness = createHarness();

		harness.focusInto("save");

		expect(harness.shown).toEqual([]);
		expect(harness.cookies).toEqual([]);
	});

	it("leaves a URL box outside a marked form alone", () => {
		const harness = createHarness();

		harness.focusInto("other-input");

		expect(harness.shown).toEqual([]);
		expect(harness.cookies).toEqual([]);
	});

	it("stays quiet for a session that has already been warned", () => {
		const harness = createHarness({ state: "seen" });

		harness.focusInto("save-input");

		expect(harness.shown).toEqual([]);
		expect(harness.cookies).toEqual([]);
	});

	it("holds a gated link back and follows it only after the reader continues", () => {
		const harness = createHarness();

		const event = harness.click("cta");

		expect(event.defaultPrevented).toBe(true);
		expect(harness.shown).toEqual(["save-tip"]);
		expect(harness.navigations).toEqual([]);

		harness.click("proceed");

		expect(harness.hidden).toEqual(["save-tip"]);
		expect(harness.navigations).toEqual(["https://readplace.com/save?url=x"]);
	});

	it("lets a gated link through once the session has already been warned", () => {
		const harness = createHarness({ state: "seen" });

		const event = harness.click("cta");

		expect(event.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("leaves links it does not gate alone", () => {
		const harness = createHarness();

		const event = harness.click("plain-cta");

		expect(event.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("ignores a middle click, which opens a tab rather than navigating this one", () => {
		const harness = createHarness();

		const event = harness.click("cta", { button: 1 });

		expect(event.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("ignores a modified click, which the reader means to open elsewhere", () => {
		const harness = createHarness();

		const event = harness.click("cta", { metaKey: true });

		expect(event.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("leaves a click another handler already claimed", () => {
		const harness = createHarness();
		// Capture phase, so it lands before the delegated listener under test —
		// exactly how another feature that claims a click would beat it.
		harness.document.addEventListener(
			"click",
			(event) => {
				event.preventDefault();
			},
			true,
		);

		harness.click("cta");

		expect(harness.shown).toEqual([]);
	});

	it("stays out of the way where the browser cannot open a popover", () => {
		const harness = createHarness({ supportsPopover: false });

		harness.focusInto("save-input");
		const clickEvent = harness.click("cta");

		expect(clickEvent.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
		expect(harness.cookies).toEqual([]);
	});

	it("stays out of the way on a page that renders no panel", () => {
		const harness = createHarness({ withPanel: false });

		harness.focusInto("save-input");
		const clickEvent = harness.click("cta");

		expect(clickEvent.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
		expect(harness.cookies).toEqual([]);
	});

	it("ignores a proceed click with nothing held back", () => {
		const harness = createHarness();

		harness.click("proceed");

		expect(harness.hidden).toEqual([]);
		expect(harness.navigations).toEqual([]);
	});

	it("ignores an event whose target is not an element at all", () => {
		const harness = createHarness();

		harness.dispatchOnDocument("focusin");
		const clickEvent = harness.dispatchOnDocument("click");

		expect(clickEvent.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("reports the panel opening, once per opening", () => {
		const harness = createHarness();

		harness.focusInto("save-input");

		expect(harness.beacons).toEqual([OPEN_BEACON]);
	});

	it("reports each opening of a gated link's panel, which the reader may reach again", () => {
		const harness = createHarness();

		harness.click("cta");
		harness.click("cta");

		expect(harness.beacons).toEqual([OPEN_BEACON, OPEN_BEACON]);
	});

	it("tells acknowledging the panel apart from closing it", () => {
		const harness = createHarness();
		harness.focusInto("save-input");

		harness.click("acknowledge");
		harness.click("close");

		expect(harness.beacons).toEqual([OPEN_BEACON, ACKNOWLEDGE_BEACON, DISMISS_BEACON]);
	});

	it("says nothing for a control the panel does not count, nor for one outside it", () => {
		const harness = createHarness();
		harness.focusInto("save-input");

		harness.click("install");
		harness.click("save");

		expect(harness.beacons).toEqual([OPEN_BEACON]);
	});

	it("stays silent on a panel that carries no beacon at all", () => {
		const harness = createHarness({ withBeacons: false });

		harness.focusInto("save-input");
		harness.click("close");

		expect(harness.shown).toEqual(["save-tip"]);
		expect(harness.beacons).toEqual([]);
	});

	it("forgets what it was holding once the reader has continued", () => {
		const harness = createHarness();
		harness.click("cta");
		harness.click("proceed");

		harness.click("proceed");

		expect(harness.navigations).toEqual(["https://readplace.com/save?url=x"]);
	});
});
