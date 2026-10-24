import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initGmailDialog } from "./gmail-dialog.client";

const CLOSED_PAGE = `<main><section id="gmail-mappings">
	<form id="gmail-add-newsletters-form"><button id="add" data-gmail-opener="add">Add newsletters</button></form>
	<form><button id="edit-tldr" data-gmail-opener="dan@tldr.tech">Edit</button></form>
	<form><button id="edit-brew" data-gmail-opener="crew@morningbrew.com">Edit</button></form>
</section></main>`;

function dialogMarkup(opener: string): string {
	return `<div id="gmail-dialog" popover="auto" role="dialog" tabindex="-1" data-gmail-dialog-opener="${opener}">
	<a id="close" href="/newsletters/gmail?discovery=started">Close</a>
	<div id="gmail-dialog-body">
		<details id="picker" data-gmail-picker><summary>Readlists</summary><input id="name"></details>
		<div id="gmail-sender-status" data-background-request></div>
		<form id="gmail-readlist-selection"><button id="apply">Apply readlists</button></form>
		<a id="cancel" href="/newsletters/gmail?discovery=started" data-gmail-dialog-cancel>Cancel</a>
		<button id="gmail-save" data-gmail-dialog-save>Save</button>
		<p class="note">No id</p>
	</div>
</div>`;
}

const OPEN_PAGE = `<main><section id="gmail-mappings">
	<form id="gmail-add-newsletters-form"><button id="add" data-gmail-opener="add">Add newsletters</button></form>
	<form><button id="edit-tldr" data-gmail-opener="dan@tldr.tech">Edit</button></form>
</section>${dialogMarkup("add")}</main>`;

function harness(options: { html?: string; supportsPopover?: boolean } = {}) {
	const dom = new JSDOM(`<!doctype html><html><body>${options.html ?? OPEN_PAGE}</body></html>`);
	const document = dom.window.document;
	const open = new Set<Element>();
	const shown: string[] = [];
	const followed: string[] = [];
	const deps = {
		document,
		supportsPopover: () => options.supportsPopover !== false,
		isOpen: (panel: Element) => open.has(panel),
		showPopover: (panel: Element) => {
			open.add(panel);
			shown.push(panel.id);
		},
		follow: (anchor: HTMLAnchorElement) => followed.push(anchor.id),
	};
	initGmailDialog(deps);
	const element = (selector: string): HTMLElement => {
		const found = document.querySelector(selector);
		assert(found instanceof dom.window.HTMLElement, `${selector} must render`);
		return found;
	};
	const fire = (target: EventTarget, type: string, detail: Record<string, unknown> = {}) =>
		target.dispatchEvent(new dom.window.CustomEvent(type, { bubbles: true, detail }));
	const toggleClosed = () => {
		const panel = element("#gmail-dialog");
		open.delete(panel);
		const event = new dom.window.Event("toggle");
		Object.defineProperty(event, "newState", { value: "closed" });
		panel.dispatchEvent(event);
	};
	const toggleClosedWithoutDialog = () => {
		const event = new dom.window.Event("toggle");
		Object.defineProperty(event, "newState", { value: "closed" });
		document.body.dispatchEvent(event);
	};
	const replaceMain = (html: string) => {
		element("main").outerHTML = html;
	};
	return { dom, document, deps, open, shown, followed, element, fire, toggleClosed, toggleClosedWithoutDialog, replaceMain };
}

describe("Gmail newsletters popup", () => {
	it("opens the server-rendered popup when the page loads, after a swap brings it in, and after history restores it", () => {
		const page = harness({ html: CLOSED_PAGE });
		assert.deepEqual(page.shown, []);
		page.replaceMain(OPEN_PAGE);
		page.fire(page.element("main"), "htmx:afterSettle");
		assert.deepEqual(page.shown, ["gmail-dialog"]);
		page.fire(page.element("main"), "htmx:afterSettle");
		assert.deepEqual(page.shown, ["gmail-dialog"]);
		page.replaceMain(OPEN_PAGE);
		page.fire(page.document.body, "htmx:historyRestore");
		assert.deepEqual(page.shown, ["gmail-dialog", "gmail-dialog"]);
		assert.deepEqual(harness().shown, ["gmail-dialog"]);
	});

	it("moves focus to Save when a refresh inside the open popup leaves nothing focused in it", () => {
		const page = harness();
		page.element("#add").focus();
		page.fire(page.element("#gmail-dialog-body"), "htmx:afterSettle");
		assert.equal(page.document.activeElement?.id, "gmail-save");
		page.element("#apply").focus();
		page.fire(page.element("#gmail-dialog-body"), "htmx:afterSettle");
		assert.equal(page.document.activeElement?.id, "apply");
	});

	it("follows Cancel when the popup is dismissed natively", () => {
		const page = harness();
		page.toggleClosed();
		assert.deepEqual(page.followed, ["cancel"]);
	});

	it("keeps the popup up while a request from inside it is in flight, and lets a background one go", () => {
		const page = harness();
		const xhr = {};
		page.fire(page.element("#gmail-sender-status"), "htmx:beforeRequest", { elt: page.element("#gmail-sender-status"), xhr: {} });
		page.fire(page.element("#gmail-readlist-selection"), "htmx:beforeRequest", { elt: page.element("#gmail-readlist-selection"), xhr });
		page.toggleClosed();
		assert.deepEqual([page.shown, page.followed], [["gmail-dialog", "gmail-dialog"], []]);
		page.fire(page.element("#gmail-readlist-selection"), "htmx:afterRequest", { elt: page.element("#gmail-readlist-selection"), xhr });
		page.toggleClosed();
		assert.deepEqual(page.followed, ["cancel"]);
	});

	it("ignores a toggle that opens the popup or comes from another element", () => {
		const page = harness();
		const opening = new page.dom.window.Event("toggle");
		Object.defineProperty(opening, "newState", { value: "open" });
		page.element("#gmail-dialog").dispatchEvent(opening);
		const picker = new page.dom.window.Event("toggle");
		Object.defineProperty(picker, "newState", { value: "closed" });
		page.element("#picker").dispatchEvent(picker);
		assert.deepEqual(page.followed, []);
	});

	it("lets Escape close an open picker inside the popup without dismissing the popup", () => {
		const page = harness();
		const press = () => {
			const event = new page.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
			page.element("#name").dispatchEvent(event);
			return event.defaultPrevented;
		};
		page.element("#picker").setAttribute("open", "");
		assert.equal(press(), true);
		page.element("#picker").removeAttribute("open");
		assert.equal(press(), false);
	});

	it("leaves Escape alone while the popup is closed", () => {
		const page = harness({ supportsPopover: false });
		page.element("#picker").setAttribute("open", "");
		const event = new page.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		page.element("#name").dispatchEvent(event);
		assert.equal(event.defaultPrevented, false);
	});

	it("sends an answer that does not hold the popup's target to the page instead", () => {
		const page = harness();
		const swap = (responseText: string) => {
			const detail: Record<string, unknown> = { target: page.element("#gmail-dialog-body"), xhr: { responseText } };
			page.fire(page.element("#gmail-dialog-body"), "htmx:beforeSwap", detail);
			return detail;
		};
		const kept = swap('<main><div id="gmail-dialog-body"></div></main>');
		assert.equal(kept.target, page.element("#gmail-dialog-body"));
		const sent = swap("<html><body><main><p>Signed out</p></main></body></html>");
		assert.deepEqual([sent.target, sent.selectOverride, sent.swapOverride], [page.element("main"), "main", "outerHTML show:none"]);
	});

	it("leaves answers alone for targets outside the popup, or inside it without an id to look for", () => {
		const page = harness();
		for (const selector of ["#gmail-mappings", ".note"]) {
			const detail: Record<string, unknown> = { target: page.element(selector), xhr: { responseText: "<p>nothing</p>" } };
			page.fire(page.element(selector), "htmx:beforeSwap", detail);
			assert.equal(detail.target, page.element(selector));
		}
	});

	it("returns focus to the control that opened the popup once it is gone, and only once", () => {
		const page = harness({ html: OPEN_PAGE.replace('data-gmail-dialog-opener="add"', 'data-gmail-dialog-opener="dan@tldr.tech"') });
		page.fire(page.element("#gmail-readlist-selection"), "htmx:beforeRequest", { elt: page.element("#gmail-readlist-selection"), xhr: {} });
		page.replaceMain(CLOSED_PAGE);
		page.fire(page.element("main"), "htmx:afterSettle");
		assert.equal(page.document.activeElement?.id, "edit-tldr");
		page.element("#edit-brew").focus();
		page.fire(page.element("main"), "htmx:afterSettle");
		assert.equal(page.document.activeElement?.id, "edit-brew");
	});

	it("lets the focus be when the control that opened the popup has gone", () => {
		const page = harness({ html: OPEN_PAGE.replace('data-gmail-dialog-opener="add"', 'data-gmail-dialog-opener="gone@example.com"') });
		page.fire(page.element("#gmail-readlist-selection"), "htmx:beforeRequest", { elt: page.element("#gmail-readlist-selection"), xhr: {} });
		page.replaceMain(CLOSED_PAGE);
		page.element("#edit-brew").focus();
		page.fire(page.element("main"), "htmx:afterSettle");
		assert.equal(page.document.activeElement?.id, "edit-brew");
	});

	it("keeps the remembered opener, and focus where it is, while background polls settle", () => {
		const page = harness();
		page.fire(page.element("#gmail-readlist-selection"), "htmx:beforeRequest", { elt: page.element("#gmail-readlist-selection"), xhr: {} });
		page.element("#add").focus();
		page.fire(page.element("#gmail-sender-status"), "htmx:afterSettle", { elt: page.element("#gmail-sender-status") });
		assert.equal(page.document.activeElement?.id, "add");
		page.replaceMain(CLOSED_PAGE);
		page.element("#edit-brew").focus();
		page.fire(page.element("main"), "htmx:afterSettle", { elt: page.element("main") });
		assert.equal(page.document.activeElement?.id, "add");
	});

	it("leaves a dismissed popup closed while its Cancel is on the way", () => {
		const page = harness();
		page.toggleClosed();
		page.fire(page.element("#gmail-dialog-body"), "htmx:afterSettle");
		assert.deepEqual([page.followed, page.shown], [["cancel"], ["gmail-dialog"]]);
	});

	it("drops the remembered opener when the popup stays after its request", () => {
		const page = harness();
		page.fire(page.element("#gmail-readlist-selection"), "htmx:beforeRequest", { elt: page.element("#gmail-readlist-selection"), xhr: {} });
		page.fire(page.element("#gmail-dialog-body"), "htmx:afterSettle");
		page.replaceMain(CLOSED_PAGE);
		page.element("#edit-brew").focus();
		page.fire(page.element("main"), "htmx:afterSettle");
		assert.equal(page.document.activeElement?.id, "edit-brew");
	});

	it("remembers no opener for a request from outside the popup, or with no popup on the page", () => {
		const page = harness();
		page.fire(page.element("#gmail-mappings"), "htmx:beforeRequest", { elt: page.element("#gmail-mappings"), xhr: {} });
		page.replaceMain(CLOSED_PAGE);
		page.fire(page.element("#gmail-mappings"), "htmx:beforeRequest", { elt: page.element("#gmail-mappings"), xhr: {} });
		page.toggleClosedWithoutDialog();
		page.element("#edit-brew").focus();
		page.fire(page.element("main"), "htmx:afterSettle");
		assert.equal(page.document.activeElement?.id, "edit-brew");
	});

	it("never shows the popup where popovers are unsupported", () => {
		const page = harness({ supportsPopover: false });
		page.fire(page.element("main"), "htmx:afterSettle");
		page.fire(page.document.body, "htmx:historyRestore");
		assert.deepEqual(page.shown, []);
	});

	it("attaches its listeners once", () => {
		const page = harness();
		initGmailDialog(page.deps);
		page.toggleClosed();
		assert.deepEqual(page.followed, ["cancel"]);
	});
});
