import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { initReadlist } from "./readlist.client";

function menusMarkup(): string {
	return `
		<details class="menu readlist-nav__menu" open data-test-readlist-menu="work"><summary class="menu__toggle" data-test-action="readlist-menu">Options</summary><div class="menu__panel"><button class="menu__item" type="button" data-test-inside>Edit</button></div></details>
		<details class="menu readlist-article__menu" open data-test-article-menu><summary class="menu__toggle" data-test-action="article-menu">More</summary></details>
		<button type="button" data-test-outside>Elsewhere</button>
	`;
}

function dialogsMarkup(): string {
	return `
		<details class="menu readlist-nav__menu" open data-test-readlist-menu="work"><summary class="menu__toggle" data-test-action="readlist-menu">Options</summary><div class="menu__panel"><button class="menu__item" type="button" popovertarget="rename-work" data-test-nav-trigger>Edit</button></div></details>
		<details class="menu readlist-article__menu" open data-test-article-menu><summary class="menu__toggle" data-test-action="article-menu">More</summary><div class="menu__panel"><button class="menu__item" type="button" popovertarget="delete-article" data-test-card-trigger>Delete</button></div></details>
		<button type="button" data-test-outside>Elsewhere</button>
		<div id="rename-work" popover data-test-dialog="nav"><button type="button" data-test-dialog-close>Close</button></div>
		<div id="delete-article" popover data-test-dialog="card"><button type="button">Close</button></div>
		<div id="orphan-dialog" popover data-test-dialog="orphan"><button type="button">Close</button></div>
		<button type="button" popovertarget="create-readlist" data-test-row-trigger>Create a readlist</button>
		<div id="create-readlist" popover data-test-dialog="row"><button type="button">Cancel</button></div>
	`;
}

const LIVE_REGION = `<div id="toast-live-region" role="status" aria-live="polite"></div>`;

function renameDialogMarkup(): string {
	return `${LIVE_REGION}<div id="readlist-rename-work" popover data-test-dialog="rename"><form data-readlist-name-form data-readlist-name-failure="Couldn't rename the readlist." data-test-form="readlist-rename" action="/queue/queues/work/rename" hx-post="/queue/queues/work/rename"><input name="label" value="Work Reading"><p data-readlist-name-error></p><button type="submit">Save</button></form></div>`;
}

function createDialogMarkup(): string {
	return `${LIVE_REGION}<div id="readlist-create" popover data-test-dialog="create"><form data-readlist-name-form data-readlist-name-failure="Couldn't create the readlist." data-test-form="readlist-create" action="/queue/queues?queue=all" hx-post="/queue/queues?queue=all"><input name="label" value="Ideas &amp; Inspiration"><p data-readlist-name-error></p><button type="submit">Create readlist</button></form></div>`;
}

function createAndMoveDialogMarkup(): string {
	return `${LIVE_REGION}<div id="readlist-create-move-abc" popover data-test-dialog="create-move"><form data-readlist-name-form data-readlist-name-failure="Couldn't create the readlist." data-test-form="readlist-create-move" action="/queue/abc/move?queue=work" hx-post="/queue/abc/move?queue=work"><input type="hidden" name="from" value="work"><input name="label" value="Finance"><p data-readlist-name-error></p><button type="submit">Create readlist</button></form></div>`;
}

function unrelatedMarkup(): string {
	return `${LIVE_REGION}<form data-test-form="unrelated" action="/somewhere" hx-post="/somewhere"><input name="x" value="y"><button type="submit">Go</button></form><a href="/queue/abc/view" data-test-card-link>Read</a>`;
}

interface AnsweredRequest {
	status: number;
	responseText: string;
	getResponseHeader: (name: string) => string | null;
}

function answered(input: { status: number; body?: string; location?: string }): AnsweredRequest {
	return {
		status: input.status,
		responseText: input.body ?? "",
		getResponseHeader: (name) => (name.toLowerCase() === "hx-location" ? (input.location ?? null) : null),
	};
}

const RENAME_LANDING = JSON.stringify({
	path: "/queue?queue=work",
	source: "#readlist-rename-work",
	target: "main",
	select: "main",
	swap: "outerHTML show:none scroll:html:top",
});

const CREATE_LANDING = JSON.stringify({
	path: "/queue?queue=0123456789abcdef",
	source: "#readlist-create",
	target: "main",
	select: "main",
	swap: "outerHTML show:none scroll:html:top",
});

function init(bodyHtml: string) {
	const virtualConsole = new VirtualConsole();
	const listenerErrors: string[] = [];
	virtualConsole.on("jsdomError", (error) => listenerErrors.push(error.message));
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, { virtualConsole });
	const document = dom.window.document;
	initReadlist({ document });

	function element<T extends Element = Element>(selector: string, description: string): T {
		const el = document.querySelector<T>(selector);
		assert(el, description);
		return el;
	}

	function navMenu(): HTMLDetailsElement {
		return element("[data-test-readlist-menu='work']", "the readlist menu must be in the document");
	}

	function cardMenu(): HTMLDetailsElement {
		return element("[data-test-article-menu]", "the card menu must be in the document");
	}

	function click(target: Element): void {
		target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	}

	function dispatchToggle(target: EventTarget, newState: string): void {
		const event = new dom.window.Event("toggle");
		Object.defineProperty(event, "newState", { value: newState });
		target.dispatchEvent(event);
	}

	function dialog(name: string): HTMLElement {
		return element<HTMLElement>(`[data-test-dialog='${name}']`, `the ${name} dialog must be in the document`);
	}

	function htmxEvent(target: Element, name: string, detail?: Record<string, unknown>): void {
		target.dispatchEvent(new dom.window.CustomEvent(name, { bubbles: true, cancelable: true, detail }));
	}

	return {
		document,
		listenerErrors: () => listenerErrors,
		navMenu,
		cardMenu,
		navSummary: () => element<HTMLElement>("[data-test-readlist-menu='work'] summary", "the readlist menu opens from a summary"),
		cardSummary: () => element<HTMLElement>("[data-test-article-menu] summary", "the card menu opens from a summary"),
		outside: () => element<HTMLElement>("[data-test-outside]", "an outside control must be in the document"),
		activeElement: () => document.activeElement,
		focusInDialog: (name: string) =>
			element<HTMLElement>(`[data-test-dialog='${name}'] button`, `the ${name} dialog must hold a control`).focus(),
		closeDialog: (name: string) => dispatchToggle(dialog(name), "closed"),
		openDialog: (name: string) => dispatchToggle(dialog(name), "open"),
		collapseNavMenu: () => dispatchToggle(navMenu(), "closed"),
		toggleOnDocument: () => dispatchToggle(document, "closed"),
		clickInside: () => click(element("[data-test-inside]", "the in-menu control must be in the document")),
		clickOutside: () => click(element("[data-test-outside]", "an outside control must be in the document")),
		pressEscape: () =>
			document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
		pressOtherKey: () =>
			document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "a", bubbles: true })),
		clickDocument: () => document.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })),
		answerBeforeSwap: (target: Element, request: AnsweredRequest) => {
			const detail: Record<string, unknown> = { xhr: request, shouldSwap: request.status === 422 || request.status < 300 };
			htmxEvent(target, "htmx:beforeSwap", detail);
			return detail;
		},
		answerAfterRequest: (target: Element, request: AnsweredRequest) =>
			htmxEvent(target, "htmx:afterRequest", { xhr: request }),
		failToSend: (target: Element) => htmxEvent(target, "htmx:sendError", { xhr: answered({ status: 0 }) }),
		failToSendWithoutDetail: (target: Element) => htmxEvent(target, "htmx:sendError"),
		nameForm: () => element("form[data-readlist-name-form]", "the name form must be in the document"),
		unrelatedForm: () => element("form[data-test-form='unrelated']", "the unrelated form must be in the document"),
		cardLink: () => element("[data-test-card-link]", "the card link must be in the document"),
		errorText: () =>
			element("[data-readlist-name-error]", "the name form must carry its error line").textContent,
		inputInvalid: () =>
			element(
				"form[data-readlist-name-form] input[name='label']",
				"the name form must carry its name input",
			).getAttribute("aria-invalid"),
		announced: () => element("#toast-live-region", "the shell mounts a live region on every page").textContent,
		invalidFields: () =>
			Array.from(document.querySelectorAll("form[data-readlist-name-form] input[aria-invalid]"), (input) =>
				input.getAttribute("name"),
			),
	};
}

describe("initReadlist", () => {
	it("keeps the menu the reader clicked inside open, and closes every other open menu", () => {
		const app = init(menusMarkup());

		app.clickInside();

		expect(app.navMenu().open).toBe(true);
		expect(app.cardMenu().open).toBe(false);
	});

	it("closes every open menu when the reader clicks outside all of them", () => {
		const app = init(menusMarkup());

		app.clickOutside();

		expect(app.navMenu().open).toBe(false);
		expect(app.cardMenu().open).toBe(false);
	});

	it("closes every open menu on Escape, wherever the reader was", () => {
		const app = init(menusMarkup());

		app.pressEscape();

		expect(app.navMenu().open).toBe(false);
		expect(app.cardMenu().open).toBe(false);
	});

	it("ignores every key that is not Escape", () => {
		const app = init(menusMarkup());

		app.pressOtherKey();

		expect(app.navMenu().open).toBe(true);
	});

	it("treats a click that names no element as outside every menu", () => {
		const app = init(menusMarkup());

		app.clickDocument();

		expect(app.navMenu().open).toBe(false);
	});

	it("lets htmx swap a refused name's form into the dialog", () => {
		const app = init(createDialogMarkup());

		const detail = app.answerBeforeSwap(
			app.nameForm(),
			answered({ status: 422, body: "<form data-readlist-name-form></form>" }),
		);

		expect(detail.shouldSwap).toBe(true);
		expect(app.errorText()).toBe("");
		expect(app.inputInvalid()).toBe(null);
	});

	it("keeps a followed redirect's whole page out of the dialog and says the create failed", () => {
		const app = init(createDialogMarkup());

		const detail = app.answerBeforeSwap(
			app.nameForm(),
			answered({ status: 200, body: "<!DOCTYPE html><html><body>Log in</body></html>" }),
		);

		expect(detail.shouldSwap).toBe(false);
		expect(app.errorText()).toBe("Couldn't create the readlist.");
		expect(app.inputInvalid()).toBe("true");
	});

	it("keeps a refused request's answer out of the dialog and says the rename failed", () => {
		const app = init(renameDialogMarkup());

		const detail = app.answerBeforeSwap(app.nameForm(), answered({ status: 403, body: "Forbidden" }));

		expect(detail.shouldSwap).toBe(false);
		expect(app.errorText()).toBe("Couldn't rename the readlist.");
		expect(app.inputInvalid()).toBe("true");
	});

	it("marks only the name field invalid, never the hidden field ahead of it, when an answer stays out of the dialog", () => {
		const app = init(createAndMoveDialogMarkup());

		const detail = app.answerBeforeSwap(app.nameForm(), answered({ status: 403, body: "Forbidden" }));

		expect(detail.shouldSwap).toBe(false);
		expect(app.errorText()).toBe("Couldn't create the readlist.");
		expect(app.invalidFields()).toEqual(["label"]);
	});

	it("marks only the name field invalid, never the hidden field ahead of it, when the request never reaches the server", () => {
		const app = init(createAndMoveDialogMarkup());

		app.failToSend(app.nameForm());

		expect(app.errorText()).toBe("Couldn't create the readlist.");
		expect(app.invalidFields()).toEqual(["label"]);
	});

	it("says the rename failed when the request never reaches the server", () => {
		const app = init(renameDialogMarkup());

		app.failToSend(app.nameForm());

		expect(app.errorText()).toBe("Couldn't rename the readlist.");
		expect(app.inputInvalid()).toBe("true");
	});

	it("announces the name the server stored when it sends the dialog to the renamed readlist", () => {
		const app = init(renameDialogMarkup());

		app.answerAfterRequest(
			app.nameForm(),
			answered({ status: 200, body: "Readlist renamed to Work Reading 2.", location: RENAME_LANDING }),
		);

		expect(app.announced()).toBe("Readlist renamed to Work Reading 2.");
		expect(app.errorText()).toBe("");
	});

	it("announces nothing for a create, which lands without a word", () => {
		const app = init(createDialogMarkup());

		app.answerAfterRequest(app.nameForm(), answered({ status: 204, location: CREATE_LANDING }));

		expect(app.announced()).toBe("");
	});

	it("announces nothing for an answer that sends the dialog nowhere", () => {
		const app = init(renameDialogMarkup());

		app.answerAfterRequest(
			app.nameForm(),
			answered({ status: 200, body: "<!DOCTYPE html><html><body>Log in</body></html>" }),
		);

		expect(app.announced()).toBe("");
	});

	it("leaves every other form, link and swap to htmx", () => {
		const app = init(unrelatedMarkup());

		const detail = app.answerBeforeSwap(app.unrelatedForm(), answered({ status: 200, body: "<main>Somewhere</main>" }));
		app.answerAfterRequest(
			app.unrelatedForm(),
			answered({ status: 200, body: "Readlist renamed to Nothing.", location: RENAME_LANDING }),
		);
		app.failToSend(app.unrelatedForm());
		app.failToSendWithoutDetail(app.cardLink());

		expect(detail.shouldSwap).toBe(true);
		expect(app.announced()).toBe("");
		expect(app.listenerErrors()).toEqual([]);
	});

	it("refuses to show a failure on a name form that has lost its failure text", () => {
		const app = init(
			`<form data-readlist-name-form><input name="label" value="Work"><p data-readlist-name-error></p></form>`,
		);

		app.failToSend(app.nameForm());

		expect(app.listenerErrors()).toEqual(["Uncaught [Error: a name form always carries its failure message]"]);
	});

	it("returns focus to the launching menu's summary when its dialog closes with focus on the body", () => {
		const app = init(dialogsMarkup());

		app.closeDialog("nav");

		expect(app.activeElement()).toBe(app.navSummary());
	});

	it("returns focus to the card menu that launched the dialog, skipping the menus that did not", () => {
		const app = init(dialogsMarkup());

		app.closeDialog("card");

		expect(app.activeElement()).toBe(app.cardSummary());
	});

	it("returns focus to the summary when focus was still inside the dialog being closed", () => {
		const app = init(dialogsMarkup());

		app.focusInDialog("nav");
		app.closeDialog("nav");

		expect(app.activeElement()).toBe(app.navSummary());
	});

	it("leaves focus alone when it has already moved to a control outside the menus", () => {
		const app = init(dialogsMarkup());

		app.outside().focus();
		app.closeDialog("nav");

		expect(app.activeElement()).toBe(app.outside());
	});

	it("does nothing while a dialog is opening", () => {
		const app = init(dialogsMarkup());

		app.openDialog("nav");

		expect(app.activeElement()).toBe(app.document.body);
	});

	it("returns focus to a trigger outside every menu when its dialog closes with focus on the body", () => {
		const app = init(dialogsMarkup());

		app.closeDialog("row");

		expect(app.activeElement()).toBe(app.document.querySelector("[data-test-row-trigger]"));
	});

	it("does nothing when a closing dialog belongs to no menu and no trigger", () => {
		const app = init(dialogsMarkup());

		app.closeDialog("orphan");

		expect(app.activeElement()).toBe(app.document.body);
	});

	it("does nothing when a menu itself collapses", () => {
		const app = init(dialogsMarkup());

		app.collapseNavMenu();

		expect(app.activeElement()).toBe(app.document.body);
	});

	it("ignores a toggle that names no element", () => {
		const app = init(dialogsMarkup());

		app.toggleOnDocument();

		expect(app.activeElement()).toBe(app.document.body);
	});
});
