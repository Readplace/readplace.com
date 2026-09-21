import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { type ReadlistResponse, initReadlist } from "./readlist.client";

interface DesignCall {
	url: string;
	init: RequestInit;
}

function menusMarkup(): string {
	return `
		<details class="readlist-nav__menu" open data-test-readlist-menu="work"><summary data-test-action="readlist-menu">Options</summary><div class="readlist-nav__menu-panel"><button type="button" data-test-inside>Edit</button></div></details>
		<details class="readlist-article__menu" open data-test-article-menu><summary data-test-action="article-menu">More</summary></details>
		<button type="button" data-test-outside>Elsewhere</button>
	`;
}

function dialogsMarkup(): string {
	return `
		<details class="readlist-nav__menu" open data-test-readlist-menu="work"><summary data-test-action="readlist-menu">Options</summary><div class="readlist-nav__menu-panel"><button type="button" popovertarget="rename-work" data-test-nav-trigger>Edit</button></div></details>
		<details class="readlist-article__menu" open data-test-article-menu><summary data-test-action="article-menu">More</summary><div class="readlist-article__menu-panel"><button type="button" popovertarget="delete-article" data-test-card-trigger>Delete</button></div></details>
		<button type="button" data-test-outside>Elsewhere</button>
		<div id="rename-work" popover data-test-dialog="nav"><button type="button" data-test-dialog-close>Close</button></div>
		<div id="delete-article" popover data-test-dialog="card"><button type="button">Close</button></div>
		<div id="orphan-dialog" popover data-test-dialog="orphan"><button type="button">Close</button></div>
	`;
}

function renameFormMarkup(action = "/queue/queues/work/rename"): string {
	return `<form data-readlist-rename data-test-form="readlist-rename" action="${action}"><input name="label" value="Work Reading"><p data-readlist-rename-error class="readlist-rename__error readlist-rename__error--hidden"></p><button type="submit">Save</button></form>`;
}

const UNRELATED_FORM = `<form data-test-form="unrelated" action="/somewhere"><input name="x" value="y"><button type="submit">Go</button></form>`;

function init(
	bodyHtml: string,
	respond: (call: DesignCall) => Promise<ReadlistResponse> = () =>
		Promise.resolve({ status: 200, json: () => Promise.resolve({ label: "Work Reading" }) }),
) {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
	const document = dom.window.document;
	const calls: DesignCall[] = [];
	const timers: { callback: () => void; ms: number }[] = [];
	let reloaded = 0;
	initReadlist({
		document,
		fetchFn: (url, requestInit) => {
			const call = { url, init: requestInit };
			calls.push(call);
			return respond(call);
		},
		reload: () => {
			reloaded += 1;
		},
		setTimeoutFn: (callback, ms) => {
			timers.push({ callback, ms });
		},
	});

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

	function submitForm(form: Element): void {
		form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
	}

	function dispatchToggle(target: EventTarget, newState: string): void {
		const event = new dom.window.Event("toggle");
		Object.defineProperty(event, "newState", { value: newState });
		target.dispatchEvent(event);
	}

	function dialog(name: string): HTMLElement {
		return element<HTMLElement>(`[data-test-dialog='${name}']`, `the ${name} dialog must be in the document`);
	}

	return {
		document,
		window: dom.window,
		calls,
		reloadCount: () => reloaded,
		pendingTimers: () => timers.map((timer) => timer.ms),
		runTimers: () => {
			const queued = timers.splice(0, timers.length);
			for (const timer of queued) timer.callback();
		},
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
		click,
		clickInside: () => click(element("[data-test-inside]", "the in-menu control must be in the document")),
		clickOutside: () => click(element("[data-test-outside]", "an outside control must be in the document")),
		pressEscape: () =>
			document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
		pressOtherKey: () =>
			document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "a", bubbles: true })),
		clickDocument: () => document.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })),
		submitOnDocument: () =>
			document.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })),
		submitOutsideForm: () =>
			document.body.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })),
		renameForm: () => element("form[data-readlist-rename]", "the rename form must be in the document"),
		submitForm,
		errorText: () =>
			element("[data-readlist-rename-error]", "the rename form must carry its error line").textContent,
		errorVisible: () =>
			element(
				"[data-readlist-rename-error]",
				"the rename form must carry its error line",
			).classList.contains("readlist-rename__error--visible"),
	};
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

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

	it("posts the rename form's fields as urlencoded data and reloads once the server confirms the new name", async () => {
		const app = init(renameFormMarkup(), () =>
			Promise.resolve({ status: 200, json: () => Promise.resolve({ label: "Work Reading 2" }) }),
		);

		app.submitForm(app.renameForm());
		await settled();

		expect(app.calls).toHaveLength(1);
		const [call] = app.calls;
		assert(call, "the rename request must have been sent");
		expect(call.url).toBe("/queue/queues/work/rename");
		expect(call.init.method).toBe("POST");
		expect(call.init.body).toBe("label=Work+Reading");
		expect(Reflect.get(Object(call.init.headers), "Content-Type")).toBe("application/x-www-form-urlencoded");
		expect(Reflect.get(Object(call.init.headers), "Accept")).toBe("application/json");
		expect(app.reloadCount()).toBe(0);
		app.runTimers();
		expect(app.reloadCount()).toBe(1);
	});

	it("shows the server's reason in the error line when the rename is refused", async () => {
		const app = init(renameFormMarkup(), () =>
			Promise.resolve({
				status: 422,
				json: () => Promise.resolve({ message: "You already have a readlist with that name." }),
			}),
		);

		app.submitForm(app.renameForm());
		await settled();

		expect(app.errorText()).toBe("You already have a readlist with that name.");
		expect(app.errorVisible()).toBe(true);
		expect(app.reloadCount()).toBe(0);
	});

	it("falls back to the generic apology when the server refuses without saying why", async () => {
		const app = init(renameFormMarkup(), () => Promise.resolve({ status: 422, json: () => Promise.resolve({}) }));

		app.submitForm(app.renameForm());
		await settled();

		expect(app.errorText()).toBe("Couldn't rename the readlist.");
	});

	it("shows the generic apology when the server's body is not valid JSON", async () => {
		const app = init(renameFormMarkup(), () =>
			Promise.resolve({ status: 500, json: () => Promise.reject(new Error("not json")) }),
		);

		app.submitForm(app.renameForm());
		await settled();

		expect(app.errorText()).toBe("Couldn't rename the readlist.");
	});

	it("shows the generic apology when the request never reaches the server", async () => {
		const app = init(renameFormMarkup(), () => Promise.reject(new Error("offline")));

		app.submitForm(app.renameForm());
		await settled();

		expect(app.errorText()).toBe("Couldn't rename the readlist.");
	});

	it("ignores a submit from a form the design client does not own", async () => {
		const app = init(UNRELATED_FORM);
		const form = app.document.querySelector("form[data-test-form='unrelated']");
		assert(form, "the unrelated form must be in the document");

		app.submitForm(form);
		await settled();

		expect(app.calls).toEqual([]);
	});

	it("ignores a submit whose target is not an element at all", async () => {
		const app = init(renameFormMarkup());

		app.submitOnDocument();
		await settled();

		expect(app.calls).toEqual([]);
	});

	it("ignores a submit that lands nowhere near a form", async () => {
		const app = init(renameFormMarkup());

		app.submitOutsideForm();
		await settled();

		expect(app.calls).toEqual([]);
	});

	it("announces the stored name to the live region before reloading", async () => {
		const app = init(
			`<div id="toast-live-region" role="status" aria-live="polite"></div>${renameFormMarkup()}`,
			() => Promise.resolve({ status: 200, json: () => Promise.resolve({ label: "Deep Work" }) }),
		);

		app.submitForm(app.renameForm());
		await settled();

		const region = app.document.querySelector("#toast-live-region");
		assert(region, "the shell mounts a live region on every page");
		expect(region.textContent).toBe("Readlist renamed to Deep Work.");
		expect(app.reloadCount()).toBe(0);
		expect(app.pendingTimers()).toEqual([150]);

		app.runTimers();

		expect(app.reloadCount()).toBe(1);
	});

	it("posts a single rename while one is already in flight", async () => {
		let resolveFetch: ((response: ReadlistResponse) => void) | undefined;
		const app = init(
			renameFormMarkup(),
			() =>
				new Promise<ReadlistResponse>((resolve) => {
					resolveFetch = resolve;
				}),
		);

		app.submitForm(app.renameForm());
		app.submitForm(app.renameForm());
		await settled();

		expect(app.calls).toHaveLength(1);
		assert(resolveFetch, "the first rename must have reached the fetch fake");
		resolveFetch({ status: 200, json: () => Promise.resolve({ label: "Work Reading" }) });
		await settled();
		app.runTimers();
		expect(app.reloadCount()).toBe(1);
	});

	it("lets the reader retry after a refused rename", async () => {
		let attempt = 0;
		const app = init(renameFormMarkup(), () => {
			attempt += 1;
			return attempt === 1
				? Promise.resolve({ status: 422, json: () => Promise.resolve({ message: "Too long." }) })
				: Promise.resolve({ status: 200, json: () => Promise.resolve({ label: "Work Reading" }) });
		});

		app.submitForm(app.renameForm());
		await settled();
		expect(app.errorText()).toBe("Too long.");

		app.submitForm(app.renameForm());
		await settled();
		app.runTimers();
		expect(app.calls).toHaveLength(2);
		expect(app.reloadCount()).toBe(1);
	});

	it("refuses to post a rename form that carries no action to send to", () => {
		const virtualConsole = new VirtualConsole();
		const jsdomErrors: Error[] = [];
		virtualConsole.on("jsdomError", (error) => jsdomErrors.push(error));
		const actionlessForm = `<form data-readlist-rename><input name="label" value="Work Reading"><p data-readlist-rename-error class="readlist-rename__error readlist-rename__error--hidden"></p></form>`;
		const dom = new JSDOM(`<!DOCTYPE html><html><body>${actionlessForm}</body></html>`, { virtualConsole });
		initReadlist({
			document: dom.window.document,
			fetchFn: () => Promise.reject(new Error("must not be called")),
			reload: () => {},
			setTimeoutFn: (callback) => {
				callback();
			},
		});
		const form = dom.window.document.querySelector("form[data-readlist-rename]");
		assert(form, "the actionless rename form must be in the document");

		form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

		expect(jsdomErrors).toHaveLength(1);
		assert.match(jsdomErrors[0]?.message ?? "", /the rename form always posts somewhere/);
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

	it("does nothing when a closing dialog belongs to no menu", () => {
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
