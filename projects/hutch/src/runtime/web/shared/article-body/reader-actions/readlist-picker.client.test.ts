import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReadlistPicker } from "./readlist-picker.client";

function picker(state: "open" | "closed"): string {
	return `<details class="article-body__readlists"${state === "open" ? " open" : ""}>
	<summary class="article-body__readlists-trigger">Add</summary>
	<ul class="article-body__readlists-menu">
		<li><form class="article-body__readlists-form"><button class="article-body__readlists-option" type="submit">Work</button></form></li>
		<li>
			<button class="article-body__readlists-option article-body__readlists-create-trigger" type="button" popovertarget="reader-readlist-create">Create a readlist</button>
			<form class="article-body__readlists-create article-body__readlists-create-fallback"><input class="form-input" name="label"></form>
		</li>
	</ul>
</details>`;
}

const PICKER = picker("open");

const TOOLBAR = `<div class="article-body__actions article-body__actions--top">
	<a class="article-body__back" href="/queue">Back</a>
	${PICKER}
	<button class="article-body__mark-read" type="submit">Read</button>
</div>
<article class="reader__body"><p id="body-copy">The article itself.</p></article>
<div id="reader-readlist-create" popover tabindex="-1"><form><input name="label" autofocus></form></div>
<div id="other-popover" popover></div>`;

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

function toggle(dom: JSDOM, { selector, newState }: { selector: string; newState: "open" | "closed" }): void {
	const popover = dom.window.document.querySelector(selector);
	assert(popover, `"${selector}" must be in the fixture to toggle`);
	popover.dispatchEvent(Object.assign(new dom.window.Event("toggle", { bubbles: false }), { newState }));
}

function focusedElement(dom: JSDOM): Element | null {
	return dom.window.document.activeElement;
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

		clickOn(dom, ".article-body__readlists-create input");

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
		focusOn(dom, ".article-body__readlists-create-trigger");

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
		focusOn(dom, ".article-body__readlists-create input");

		pressKey(dom, "Escape");

		expect(isOpen(dom)).toBe(false);
		expect(dom.window.document.activeElement?.getAttribute("name")).toBe("label");
	});

	it("still closes a picker whose trigger is missing rather than throwing", () => {
		const dom = attachedDom(
			`<details class="article-body__readlists" open><ul class="article-body__readlists-menu"><li><input class="form-input" name="label"></li></ul></details>`,
		);
		focusOn(dom, ".form-input");

		pressKey(dom, "Escape");

		expect(isOpen(dom)).toBe(false);
	});
});

describe("readlist picker and the create dialog it opens", () => {
	it("closes the picker as the create dialog opens over it", () => {
		const dom = attachedDom();

		toggle(dom, { selector: "#reader-readlist-create", newState: "open" });

		expect(isOpen(dom)).toBe(false);
	});

	it("hands focus back to Add when the dialog closes and focus has fallen to the page", () => {
		const dom = attachedDom(TOOLBAR.replace(PICKER, picker("closed")));

		toggle(dom, { selector: "#reader-readlist-create", newState: "closed" });

		expect(focusedElement(dom)?.className).toBe("article-body__readlists-trigger");
	});

	it("hands focus back to Add when the dialog closes with focus still inside it, as the browser leaves it until its next frame", () => {
		const dom = attachedDom(TOOLBAR.replace(PICKER, picker("closed")));
		focusOn(dom, '#reader-readlist-create input[name="label"]');

		toggle(dom, { selector: "#reader-readlist-create", newState: "closed" });

		expect(focusedElement(dom)?.className).toBe("article-body__readlists-trigger");
	});

	it("hands focus back to Add when the dialog closes with focus still on its own panel", () => {
		const dom = attachedDom(TOOLBAR.replace(PICKER, picker("closed")));
		focusOn(dom, "#reader-readlist-create");

		toggle(dom, { selector: "#reader-readlist-create", newState: "closed" });

		expect(focusedElement(dom)?.className).toBe("article-body__readlists-trigger");
	});

	it("leaves focus where it is when the dialog closes with focus already on a control", () => {
		const dom = attachedDom(TOOLBAR.replace(PICKER, picker("closed")));
		focusOn(dom, ".article-body__mark-read");

		toggle(dom, { selector: "#reader-readlist-create", newState: "closed" });

		expect(focusedElement(dom)?.className).toBe("article-body__mark-read");
	});

	it("ignores a popover the picker does not open", () => {
		const dom = attachedDom();

		toggle(dom, { selector: "#other-popover", newState: "open" });
		toggle(dom, { selector: "#other-popover", newState: "closed" });

		expect(isOpen(dom)).toBe(true);
		expect(focusedElement(dom)?.tagName).toBe("BODY");
	});

	it("leaves focus on the page when the picker that opened the dialog has no trigger", () => {
		const dom = attachedDom(
			`<details class="article-body__readlists"><ul class="article-body__readlists-menu"><li><button type="button" popovertarget="reader-readlist-create">Create a readlist</button></li></ul></details><div id="reader-readlist-create" popover></div>`,
		);

		toggle(dom, { selector: "#reader-readlist-create", newState: "closed" });

		expect(focusedElement(dom)?.tagName).toBe("BODY");
	});
});

describe("readlist picker opening", () => {
	const CREATE_ONLY = `<details class="article-body__readlists" open>
	<summary class="article-body__readlists-trigger">Add</summary>
	<ul class="article-body__readlists-menu">
		<li><button class="article-body__readlists-option article-body__readlists-create-trigger" type="button" popovertarget="reader-readlist-create">Create a readlist</button></li>
	</ul>
</details>`;

	function togglePicker(dom: JSDOM): void {
		const details = dom.window.document.querySelector(".article-body__readlists");
		assert(details, "the picker must be in the fixture");
		details.dispatchEvent(new dom.window.Event("toggle", { bubbles: false }));
	}

	it("moves focus to the first readlist it can file into as it opens", () => {
		const dom = attachedDom();

		togglePicker(dom);

		expect(focusedElement(dom)?.textContent).toBe("Work");
	});

	it("leaves focus alone when the toggle closed it", () => {
		const dom = attachedDom(picker("closed"));

		togglePicker(dom);

		expect(focusedElement(dom)).toBe(dom.window.document.body);
	});

	it("never picks the create trigger, so a picker with no readlist to file into moves no focus", () => {
		const dom = attachedDom(CREATE_ONLY);

		togglePicker(dom);

		expect(focusedElement(dom)).toBe(dom.window.document.body);
	});

	it("ignores another element's toggle", () => {
		const dom = attachedDom();

		toggle(dom, { selector: "#other-popover", newState: "open" });

		expect(focusedElement(dom)).toBe(dom.window.document.body);
	});
});
