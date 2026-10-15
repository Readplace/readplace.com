import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { initChangePassword } from "./change-password.client";

const FORM_MARKUP = `<form method="POST" action="/account/password" hx-post="/account/password" hx-target="this" data-change-password-form data-change-password-failure="Couldn't change your password."><input name="currentPassword" type="password"><p data-change-password-failure-line></p><button type="submit">Change password</button></form>`;

function init(bodyHtml: string) {
	const virtualConsole = new VirtualConsole();
	const listenerErrors: string[] = [];
	virtualConsole.on("jsdomError", (error) => listenerErrors.push(error.message));
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, { virtualConsole });
	const document = dom.window.document;
	initChangePassword({ document });

	function element({ selector, description }: { selector: string; description: string }): Element {
		const el = document.querySelector(selector);
		assert(el, description);
		return el;
	}

	function htmxEvent(target: Element, name: string, detail?: Record<string, unknown>): void {
		target.dispatchEvent(new dom.window.CustomEvent(name, { bubbles: true, cancelable: true, detail }));
	}

	return {
		listenerErrors: () => listenerErrors,
		form: () => element({ selector: "form", description: "the form must be in the document" }),
		passwordForm: () => element({ selector: "form[data-change-password-form]", description: "the change-password form must be in the document" }),
		failureLine: () => element({ selector: "p", description: "the form must carry its failure line" }).textContent,
		answer: (target: Element, status: number) => {
			const detail: Record<string, unknown> = { xhr: { status }, shouldSwap: status === 422 || status < 300 };
			htmxEvent(target, "htmx:beforeSwap", detail);
			return detail;
		},
		failToSend: (target: Element) => htmxEvent(target, "htmx:sendError", { xhr: { status: 0 } }),
		resend: (target: Element) => htmxEvent(target, "htmx:beforeRequest", {}),
		failToSendFromDocument: () =>
			document.dispatchEvent(new dom.window.CustomEvent("htmx:sendError", { bubbles: true, detail: { xhr: { status: 0 } } })),
	};
}

describe("initChangePassword", () => {
	it("shows the failure line and keeps the form when the server answers a 5xx", () => {
		const app = init(FORM_MARKUP);

		const detail = app.answer(app.form(), 503);

		expect([detail.shouldSwap, app.failureLine()]).toEqual([false, "Couldn't change your password."]);
	});

	it("shows the failure line when the request never reaches the server", () => {
		const app = init(FORM_MARKUP);

		app.failToSend(app.form());

		expect(app.failureLine()).toBe("Couldn't change your password.");
	});

	it("clears the failure line when the form is sent again", () => {
		const app = init(FORM_MARKUP);
		app.failToSend(app.form());

		app.resend(app.form());

		expect(app.failureLine()).toBe("");
	});

	it("keeps an unexpected page out of the form", () => {
		const app = init(FORM_MARKUP);

		const detail = app.answer(app.form(), 200);

		expect([detail.shouldSwap, app.failureLine()]).toEqual([false, "Couldn't change your password."]);
	});

	it("lets a refusal swap the re-rendered form in, with no failure line", () => {
		const app = init(FORM_MARKUP);

		const detail = app.answer(app.form(), 422);

		expect([detail.shouldSwap, app.failureLine()]).toEqual([true, ""]);
	});

	it("leaves every other form's answers alone", () => {
		const app = init(`<form data-test-other hx-post="/elsewhere"><button type="submit">Go</button></form>${FORM_MARKUP}`);
		const other = app.form();

		app.failToSend(app.passwordForm());
		const detail = app.answer(other, 500);
		app.failToSend(other);
		app.resend(other);

		expect([detail.shouldSwap, app.failureLine()]).toEqual([false, "Couldn't change your password."]);
	});

	it("ignores an event whose target is not an element", () => {
		const app = init(FORM_MARKUP);

		app.failToSendFromDocument();

		expect([app.failureLine(), app.listenerErrors()]).toEqual(["", []]);
	});

	it.each([
		{ missing: "failure line", markup: FORM_MARKUP.replace("<p data-change-password-failure-line></p>", ""), error: "the change-password form always carries its failure line" },
		{ missing: "failure message", markup: FORM_MARKUP.replace(` data-change-password-failure="Couldn't change your password."`, ""), error: "the change-password form always carries its failure message" },
	])("refuses to show a failure on a form that has lost its $missing", ({ markup, error }) => {
		const app = init(markup);

		app.failToSend(app.form());

		expect(app.listenerErrors()).toEqual([`Uncaught [Error: ${error}]`]);
	});
});
