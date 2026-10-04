import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initGmailPicker } from "./gmail-picker.client";

function fixture(): JSDOM {
	const dom = new JSDOM(`<button id="outside">Outside</button>
		<details data-gmail-picker id="sender" open><summary data-gmail-picker-trigger>Sender</summary><input id="search" data-gmail-picker-focus></details>
		<details data-gmail-picker id="destination"><summary data-gmail-picker-trigger>Inbox</summary><button id="option">Inbox</button></details>`);
	initGmailPicker({ document: dom.window.document });
	return dom;
}

function element(dom: JSDOM, selector: string): HTMLElement {
	const found = dom.window.document.querySelector(selector);
	assert(found instanceof dom.window.HTMLElement);
	return found;
}

function key(dom: JSDOM, value: string): void {
	dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true }));
}

function pressFromFocus(dom: JSDOM, value: string): boolean {
	const focused = dom.window.document.activeElement;
	assert(focused, "a key press starts from the focused element");
	const event = new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
	focused.dispatchEvent(event);
	return event.defaultPrevented;
}

describe("Gmail details pickers", () => {
	it("dismisses notification borders on any click and keeps them dismissed after an htmx replacement", () => {
		const dom = fixture();
		const document = dom.window.document;
		document.body.insertAdjacentHTML("beforeend", '<div id="notice" data-gmail-notification="dan@tldr.tech" data-gmail-notification-highlight><button disabled>Save</button></div>');
		element(dom, "#outside").click();
		assert.equal(element(dom, "#notice").hasAttribute("data-gmail-notification-highlight"), false);
		element(dom, "#notice").setAttribute("data-gmail-notification-highlight", "");
		document.dispatchEvent(new dom.window.Event("htmx:afterSwap"));
		assert.equal(element(dom, "#notice").hasAttribute("data-gmail-notification-highlight"), false);
		element(dom, "#notice").setAttribute("data-gmail-notification", "crew@morningbrew.com");
		element(dom, "#notice").setAttribute("data-gmail-notification-highlight", "");
		document.dispatchEvent(new dom.window.Event("htmx:afterSwap"));
		assert.equal(element(dom, "#notice").hasAttribute("data-gmail-notification-highlight"), true);
		element(dom, "#notice button").dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
		assert.equal(element(dom, "#notice").hasAttribute("data-gmail-notification-highlight"), false);
	});

	it("clears a notification presentation marker even if it has no sender", () => {
		const dom = fixture();
		dom.window.document.body.insertAdjacentHTML("beforeend", '<div id="notice" data-gmail-notification-highlight></div>');
		element(dom, "#outside").click();
		assert.equal(dom.window.document.documentElement.getAttribute("data-gmail-notification-dismissed"), "");
		assert.equal(element(dom, "#notice").hasAttribute("data-gmail-notification-highlight"), false);
	});

	it("keeps inside clicks open and dismisses the other picker", () => {
		const dom = fixture();
		element(dom, "#search").click();
		assert.equal(element(dom, "#sender").hasAttribute("open"), true);
		element(dom, "#destination summary").click();
		assert.equal(element(dom, "#sender").hasAttribute("open"), false);
		assert.equal(element(dom, "#destination").hasAttribute("open"), true);
		element(dom, "#outside").click();
		assert.equal(element(dom, "#destination").hasAttribute("open"), false);
	});

	it("focuses search on open and returns to the trigger on Escape", () => {
		const dom = fixture();
		initGmailPicker({ document: dom.window.document });
		element(dom, "#sender").dispatchEvent(new dom.window.Event("toggle"));
		assert.equal(dom.window.document.activeElement, element(dom, "#search"));
		key(dom, "Enter");
		assert.equal(element(dom, "#sender").hasAttribute("open"), true);
		key(dom, "Escape");
		assert.equal(element(dom, "#sender").hasAttribute("open"), false);
		assert.equal(dom.window.document.activeElement, element(dom, "#sender summary"));
	});

	it("does not steal focus for outside Escape, closing toggles or other elements", () => {
		const dom = fixture();
		element(dom, "#outside").focus();
		element(dom, "#outside").dispatchEvent(new dom.window.Event("toggle"));
		assert.equal(dom.window.document.activeElement, element(dom, "#outside"));
		key(dom, "Escape");
		element(dom, "#sender").dispatchEvent(new dom.window.Event("toggle"));
		assert.equal(dom.window.document.activeElement, element(dom, "#outside"));
		element(dom, "#destination").setAttribute("open", "");
		element(dom, "#destination").dispatchEvent(new dom.window.Event("toggle"));
		assert.equal(dom.window.document.activeElement, element(dom, "#outside"));
	});

	it("handles a replaced picker missing optional focus targets", () => {
		const dom = fixture();
		element(dom, "#sender summary").remove();
		element(dom, "#search").focus();
		key(dom, "Escape");
		assert.equal(element(dom, "#sender").hasAttribute("open"), false);
	});

	it("moves focus through an open picker's search and options with the arrow keys, stopping at either end", () => {
		const dom = new JSDOM(`<details data-gmail-picker id="newsletter" open><summary data-gmail-picker-trigger>Newsletter</summary><input id="search" data-gmail-picker-focus><button id="first" data-gmail-picker-option>TLDR</button><button id="second" data-gmail-picker-option>Morning Brew</button></details>`);
		initGmailPicker({ document: dom.window.document });
		element(dom, "#newsletter summary").focus();
		assert.equal(pressFromFocus(dom, "ArrowDown"), true);
		assert.equal(dom.window.document.activeElement, element(dom, "#search"));
		pressFromFocus(dom, "ArrowDown");
		pressFromFocus(dom, "ArrowDown");
		assert.equal(dom.window.document.activeElement, element(dom, "#second"));
		pressFromFocus(dom, "ArrowDown");
		assert.equal(dom.window.document.activeElement, element(dom, "#second"));
		pressFromFocus(dom, "ArrowUp");
		assert.equal(dom.window.document.activeElement, element(dom, "#first"));
		pressFromFocus(dom, "ArrowUp");
		pressFromFocus(dom, "ArrowUp");
		assert.equal(dom.window.document.activeElement, element(dom, "#search"));
	});

	it("leaves arrow keys alone outside an open picker and in a picker with nothing to choose", () => {
		const dom = new JSDOM(`<button id="outside">Outside</button>
			<details data-gmail-picker id="closed"><summary data-gmail-picker-trigger>Closed</summary><button id="hidden-option" data-gmail-picker-option>Hidden</button></details>
			<details data-gmail-picker id="empty" open><summary data-gmail-picker-trigger>Empty</summary></details>`);
		initGmailPicker({ document: dom.window.document });
		element(dom, "#outside").focus();
		assert.equal(pressFromFocus(dom, "ArrowDown"), false);
		assert.equal(dom.window.document.activeElement, element(dom, "#outside"));
		element(dom, "#closed summary").focus();
		assert.equal(pressFromFocus(dom, "ArrowDown"), false);
		assert.equal(dom.window.document.activeElement, element(dom, "#closed summary"));
		element(dom, "#empty summary").focus();
		assert.equal(pressFromFocus(dom, "ArrowUp"), true);
		assert.equal(dom.window.document.activeElement, element(dom, "#empty summary"));
		assert.equal(pressFromFocus(dom, "ArrowLeft"), false);
	});

	it("focuses the new readlist name when the readlist picker opens beside the newsletter picker", () => {
		const dom = new JSDOM(`<details data-gmail-picker id="newsletter" open><summary data-gmail-picker-trigger>Newsletter</summary><input id="search" data-gmail-picker-focus></details>
			<details data-gmail-picker id="readlist"><summary data-gmail-picker-trigger>Readlist</summary><input id="readlist-name" data-gmail-picker-focus></details>`);
		initGmailPicker({ document: dom.window.document });
		element(dom, "#readlist summary").click();
		element(dom, "#readlist").setAttribute("open", "");
		element(dom, "#readlist").dispatchEvent(new dom.window.Event("toggle"));
		assert.equal(element(dom, "#newsletter").hasAttribute("open"), false);
		assert.equal(dom.window.document.activeElement, element(dom, "#readlist-name"));
	});
});
