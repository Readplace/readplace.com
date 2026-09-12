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

describe("Gmail details pickers", () => {
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
});
