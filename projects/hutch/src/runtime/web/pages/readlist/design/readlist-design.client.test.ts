import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { type ReadlistDesignResponse, initReadlistDesign } from "./readlist-design.client";

interface DesignCall {
	url: string;
	init: RequestInit;
}

function menusMarkup(): string {
	return `
		<details class="readlist-design-nav__menu" open data-test-readlist-menu="work"><summary data-test-action="readlist-menu">Options</summary><div class="readlist-design-nav__menu-panel"><button type="button" data-test-inside>Edit</button></div></details>
		<details class="readlist-design-card__menu" open data-test-article-menu><summary data-test-action="article-menu">More</summary></details>
		<button type="button" data-test-outside>Elsewhere</button>
	`;
}

function renameFormMarkup(action = "/queue/queues/work/rename"): string {
	return `<form data-readlist-design-rename data-test-form="readlist-rename" action="${action}"><input name="label" value="Work Reading"><p data-readlist-design-rename-error class="readlist-design-rename__error readlist-design-rename__error--hidden"></p><button type="submit">Save</button></form>`;
}

const UNRELATED_FORM = `<form data-test-form="unrelated" action="/somewhere"><input name="x" value="y"><button type="submit">Go</button></form>`;

function init(
	bodyHtml: string,
	respond: (call: DesignCall) => Promise<ReadlistDesignResponse> = () =>
		Promise.resolve({ status: 200, json: () => Promise.resolve({ label: "Work Reading" }) }),
) {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
	const document = dom.window.document;
	const calls: DesignCall[] = [];
	let reloaded = 0;
	initReadlistDesign({
		document,
		fetchFn: (url, requestInit) => {
			const call = { url, init: requestInit };
			calls.push(call);
			return respond(call);
		},
		reload: () => {
			reloaded += 1;
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

	return {
		document,
		window: dom.window,
		calls,
		reloadCount: () => reloaded,
		navMenu,
		cardMenu,
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
		renameForm: () => element("form[data-readlist-design-rename]", "the rename form must be in the document"),
		submitForm,
		errorText: () =>
			element("[data-readlist-design-rename-error]", "the rename form must carry its error line").textContent,
		errorVisible: () =>
			element(
				"[data-readlist-design-rename-error]",
				"the rename form must carry its error line",
			).classList.contains("readlist-design-rename__error--visible"),
	};
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

describe("initReadlistDesign", () => {
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

	it("refuses to post a rename form that carries no action to send to", () => {
		const virtualConsole = new VirtualConsole();
		const jsdomErrors: Error[] = [];
		virtualConsole.on("jsdomError", (error) => jsdomErrors.push(error));
		const actionlessForm = `<form data-readlist-design-rename><input name="label" value="Work Reading"><p data-readlist-design-rename-error class="readlist-design-rename__error readlist-design-rename__error--hidden"></p></form>`;
		const dom = new JSDOM(`<!DOCTYPE html><html><body>${actionlessForm}</body></html>`, { virtualConsole });
		initReadlistDesign({
			document: dom.window.document,
			fetchFn: () => Promise.reject(new Error("must not be called")),
			reload: () => {},
		});
		const form = dom.window.document.querySelector("form[data-readlist-design-rename]");
		assert(form, "the actionless rename form must be in the document");

		form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

		expect(jsdomErrors).toHaveLength(1);
		assert.match(jsdomErrors[0]?.message ?? "", /the rename form always posts somewhere/);
	});
});
