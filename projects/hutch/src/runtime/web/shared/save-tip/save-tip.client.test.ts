import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { initSaveTip } from "./save-tip.client";

const PAGE_URL = "https://readplace.com/queue";

const PANEL = `<div class="confirm-popover" id="save-tip" popover="auto" role="dialog">
	<div class="confirm-popover__actions">
		<button id="proceed" class="btn btn--primary" type="button" data-save-tip-proceed>Save the link anyway</button>
		<a id="install" class="btn btn--secondary" href="/install">See the ways to save</a>
	</div>
</div>`;

function page(state: string): string {
	return `<main>
	<form id="save-form" method="POST" action="/queue/save" data-save-tip="${state}">
		<input type="url" name="url" value="https://example.com/post">
		<button id="save" type="submit">Save</button>
	</form>
	<form id="other-form" method="POST" action="/queue/other">
		<button id="other-save" type="submit">Other</button>
	</form>
	<a id="cta" href="https://readplace.com/save?url=x" data-save-tip="${state}">Save to My Queue</a>
	<a id="plain-cta" href="https://readplace.com/elsewhere">Elsewhere</a>
	${PANEL}
</main>`;
}

function createHarness(
	options: { state?: string; supportsPopover?: boolean; withPanel?: boolean } = {},
) {
	const body = page(options.state ?? "due");
	const dom = new JSDOM(
		`<!doctype html><html><body>${options.withPanel === false ? body.replace(PANEL, "") : body}</body></html>`,
		{ url: PAGE_URL, virtualConsole: new VirtualConsole() },
	);
	const document = dom.window.document;
	const shown: string[] = [];
	const hidden: string[] = [];
	const navigations: string[] = [];
	const submitted: string[] = [];

	// jsdom implements neither requestSubmit nor real navigation, so both are
	// recorded here instead of performed.
	for (const form of document.querySelectorAll("form")) {
		Reflect.set(form, "requestSubmit", () => {
			submitted.push(form.id);
		});
	}

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
	});

	function element(id: string): Element {
		const found = document.getElementById(id);
		assert(found, `#${id} must exist in the fixture`);
		return found;
	}

	function submit(id: string): Event {
		const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
		element(id).dispatchEvent(event);
		return event;
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
		submit,
		click,
		dispatchOnDocument,
		shown,
		hidden,
		navigations,
		submitted,
	};
}

describe("initSaveTip", () => {
	it("holds a gated save back and shows the panel instead", () => {
		const harness = createHarness();

		const event = harness.submit("save-form");

		expect(event.defaultPrevented).toBe(true);
		expect(harness.shown).toEqual(["save-tip"]);
		expect(harness.submitted).toEqual([]);
	});

	it("lets the save through once the session has already been warned", () => {
		const harness = createHarness({ state: "seen" });

		const event = harness.submit("save-form");

		expect(event.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("leaves forms it does not gate alone", () => {
		const harness = createHarness();

		const event = harness.submit("other-form");

		expect(event.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("submits the held form when the reader chooses to continue", () => {
		const harness = createHarness();
		harness.submit("save-form");

		harness.click("proceed");

		expect(harness.hidden).toEqual(["save-tip"]);
		expect(harness.submitted).toEqual(["save-form"]);
	});

	it("does not re-open the panel on the submit its own proceed control triggers", () => {
		const harness = createHarness();
		harness.submit("save-form");
		harness.click("proceed");

		const event = harness.submit("save-form");

		expect(event.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual(["save-tip"]);
	});

	it("holds a gated link back and follows it only after the reader continues", () => {
		const harness = createHarness();

		const event = harness.click("cta");

		expect(event.defaultPrevented).toBe(true);
		expect(harness.shown).toEqual(["save-tip"]);
		expect(harness.navigations).toEqual([]);

		harness.click("proceed");

		expect(harness.navigations).toEqual(["https://readplace.com/save?url=x"]);
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

		const submitEvent = harness.submit("save-form");
		const clickEvent = harness.click("cta");

		expect(submitEvent.defaultPrevented).toBe(false);
		expect(clickEvent.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("stays out of the way on a page that renders no panel", () => {
		const harness = createHarness({ withPanel: false });

		const submitEvent = harness.submit("save-form");
		const clickEvent = harness.click("cta");

		expect(submitEvent.defaultPrevented).toBe(false);
		expect(clickEvent.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("ignores a proceed click with nothing held back", () => {
		const harness = createHarness();

		harness.click("proceed");

		expect(harness.hidden).toEqual([]);
		expect(harness.submitted).toEqual([]);
		expect(harness.navigations).toEqual([]);
	});

	it("ignores an event whose target is not an element at all", () => {
		const harness = createHarness();

		const submitEvent = harness.dispatchOnDocument("submit");
		const clickEvent = harness.dispatchOnDocument("click");

		expect(submitEvent.defaultPrevented).toBe(false);
		expect(clickEvent.defaultPrevented).toBe(false);
		expect(harness.shown).toEqual([]);
	});

	it("forgets what it was holding once the reader has continued", () => {
		const harness = createHarness();
		harness.submit("save-form");
		harness.click("proceed");

		harness.click("proceed");

		expect(harness.submitted).toEqual(["save-form"]);
	});
});
