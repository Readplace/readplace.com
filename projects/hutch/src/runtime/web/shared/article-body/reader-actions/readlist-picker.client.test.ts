import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReadlistPicker } from "./readlist-picker.client";

function picker(state: "open" | "closed"): string {
	return `<details class="article-body__readlists"${state === "open" ? " open" : ""}>
	<summary class="article-body__readlists-trigger">Add</summary>
	<ul class="article-body__readlists-menu">
		<li><form class="article-body__readlists-form"><button type="submit">Work</button></form></li>
		<li><form class="article-body__readlists-create"><input class="article-body__readlists-create-input" name="label"></form></li>
	</ul>
</details>`;
}

const PICKER = picker("open");

const TOOLBAR = `<div class="article-body__actions article-body__actions--top">
	<a class="article-body__back" href="/queue">Back</a>
	${PICKER}
	<button class="article-body__mark-read" type="submit">Read</button>
</div>
<article class="reader__body"><p id="body-copy">The article itself.</p></article>`;

function attachedDom(bodyHtml: string = TOOLBAR): JSDOM {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, {
		url: "https://readplace.com/queue/abc/view",
	});
	initReadlistPicker({ document: dom.window.document }).attach();
	return dom;
}

function pressKey(dom: JSDOM, key: string): void {
	dom.window.document.dispatchEvent(
		new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
	);
}

function focusOn(dom: JSDOM, selector: string): void {
	const target = dom.window.document.querySelector(selector);
	assert(target instanceof dom.window.HTMLElement, `"${selector}" must be focusable`);
	target.focus();
}

function clickOn(dom: JSDOM, selector: string): void {
	const target = dom.window.document.querySelector(selector);
	assert(target, `"${selector}" must be in the fixture to be clicked`);
	target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}

function isOpen(dom: JSDOM): boolean {
	const picker = dom.window.document.querySelector(".article-body__readlists");
	assert(picker, "the picker must be in the fixture");
	return picker.hasAttribute("open");
}

function dispatchToggle(dom: JSDOM, selector = ".article-body__readlists"): void {
	const details = dom.window.document.querySelector(selector);
	assert(details, `"${selector}" must be in the fixture to toggle`);
	details.dispatchEvent(new dom.window.Event("toggle", { bubbles: false }));
}

const CREATE_ITEM = `<li class="article-body__readlists-create-item"><form class="article-body__readlists-create"><input class="article-body__readlists-create-input" name="label"><button type="submit">Create</button></form></li>`;
const ASSIGN_ITEM = `<li class="article-body__readlists-item"><form class="article-body__readlists-form"><button class="article-body__readlists-option" type="submit">Work</button></form></li>`;
const SENTINEL = `<button id="sentinel" type="button">elsewhere</button>`;
const OTHER_POPOVER = `<div id="other-popover"></div>`;

function pickerMenu({ open, items }: { open: boolean; items: string }): string {
	return `<details class="article-body__readlists"${open ? " open" : ""}>
	<summary class="article-body__readlists-trigger">Add</summary>
	<ul class="article-body__readlists-menu">${items}</ul>
</details>`;
}

function activeId(dom: JSDOM): string | undefined {
	const active = dom.window.document.activeElement;
	return active instanceof dom.window.HTMLElement ? active.id : undefined;
}

describe("readlist picker light dismiss", () => {
	it("closes when the click lands on the article behind it", () => {
		const dom = attachedDom();

		clickOn(dom, "#body-copy");

		expect(isOpen(dom)).toBe(false);
	});

	it("closes when the click lands on another control in the same toolbar", () => {
		const dom = attachedDom();

		clickOn(dom, ".article-body__mark-read");

		expect(isOpen(dom)).toBe(false);
	});

	it("stays open while the reader is typing a new readlist name inside it", () => {
		const dom = attachedDom();

		clickOn(dom, ".article-body__readlists-create-input");

		expect(isOpen(dom)).toBe(true);
	});

	it("stays open when the click lands on one of its own assign buttons", () => {
		const dom = attachedDom();

		clickOn(dom, ".article-body__readlists-form button");

		expect(isOpen(dom)).toBe(true);
	});

	it("does not undo the trigger's own click as the browser opens it", () => {
		const dom = attachedDom(picker("closed"));

		clickOn(dom, ".article-body__readlists-trigger");

		expect(isOpen(dom)).toBe(true);
	});

	it("closes a picker the reader left open when a second one is opened", () => {
		const dom = attachedDom(`${picker("open")}<div id="second">${picker("closed")}</div>`);
		const [first, second] = Array.from(
			dom.window.document.querySelectorAll(".article-body__readlists"),
		);
		assert(first && second, "the fixture must carry two pickers");

		clickOn(dom, "#second .article-body__readlists-trigger");

		expect(first.hasAttribute("open")).toBe(false);
		expect(second.hasAttribute("open")).toBe(true);
	});
});

describe("readlist picker escape", () => {
	it("closes on Escape and hands focus back to the trigger the reader opened", () => {
		const dom = attachedDom();
		focusOn(dom, ".article-body__readlists-create-input");

		pressKey(dom, "Escape");

		expect(isOpen(dom)).toBe(false);
		expect(dom.window.document.activeElement?.className).toBe("article-body__readlists-trigger");
	});

	it("closes on Escape pressed from outside without stealing focus into the toolbar", () => {
		const dom = attachedDom();
		focusOn(dom, ".article-body__mark-read");

		pressKey(dom, "Escape");

		expect(isOpen(dom)).toBe(false);
		expect(dom.window.document.activeElement?.className).toBe("article-body__mark-read");
	});

	it("leaves every other key to the page", () => {
		const dom = attachedDom();

		pressKey(dom, "Enter");

		expect(isOpen(dom)).toBe(true);
	});

	it("does not move focus for a picker that was already closed", () => {
		const dom = attachedDom(picker("closed"));
		focusOn(dom, ".article-body__readlists-create-input");

		pressKey(dom, "Escape");

		expect(isOpen(dom)).toBe(false);
		expect(dom.window.document.activeElement?.className).toBe(
			"article-body__readlists-create-input",
		);
	});

	it("still closes a picker whose trigger is missing rather than throwing", () => {
		const dom = attachedDom(
			`<details class="article-body__readlists" open><ul class="article-body__readlists-menu"><li><input class="article-body__readlists-create-input"></li></ul></details>`,
		);
		focusOn(dom, ".article-body__readlists-create-input");

		pressKey(dom, "Escape");

		expect(isOpen(dom)).toBe(false);
	});
});

describe("readlist picker auto-focus on open", () => {
	it("puts the cursor in the create field when naming a new readlist is the only option", () => {
		const dom = attachedDom(SENTINEL + pickerMenu({ open: true, items: CREATE_ITEM }));
		focusOn(dom, "#sentinel");

		dispatchToggle(dom);

		expect(dom.window.document.activeElement?.className).toBe(
			"article-body__readlists-create-input",
		);
	});

	it("leaves focus alone when there are existing readlists to pick from", () => {
		const dom = attachedDom(SENTINEL + pickerMenu({ open: true, items: ASSIGN_ITEM + CREATE_ITEM }));
		focusOn(dom, "#sentinel");

		dispatchToggle(dom);

		expect(activeId(dom)).toBe("sentinel");
	});

	it("does not steal focus when the toggle fires as the picker closes", () => {
		const dom = attachedDom(SENTINEL + pickerMenu({ open: false, items: CREATE_ITEM }));
		focusOn(dom, "#sentinel");

		dispatchToggle(dom);

		expect(activeId(dom)).toBe("sentinel");
	});

	it("does nothing for an open picker that has no create field either", () => {
		const dom = attachedDom(SENTINEL + pickerMenu({ open: true, items: "" }));
		focusOn(dom, "#sentinel");

		dispatchToggle(dom);

		expect(activeId(dom)).toBe("sentinel");
	});

	it("ignores a toggle from another element (e.g. a popover) while an option-less picker is open", () => {
		const dom = attachedDom(
			SENTINEL + pickerMenu({ open: true, items: CREATE_ITEM }) + OTHER_POPOVER,
		);
		focusOn(dom, "#sentinel");

		dispatchToggle(dom, "#other-popover");

		expect(activeId(dom)).toBe("sentinel");
	});
});
