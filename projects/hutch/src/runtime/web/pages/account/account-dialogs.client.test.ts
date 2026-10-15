import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initAccountDialogs } from "./account-dialogs.client";

const ACCOUNT_MARKUP = `
	<div id="disconnect-app-1" popover data-test-dialog="disconnect">
		<button type="button" popovertarget="disconnect-app-1" popovertargetaction="hide" data-test-dialog-cancel>Cancel</button>
	</div>
	<button type="button" popovertarget="disconnect-app-1" data-test-trigger>Disconnect</button>
	<button type="button" data-test-outside>Edit</button>
	<div id="unopened" popover data-test-dialog="orphan"><button type="button">Close</button></div>
`;

function init() {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${ACCOUNT_MARKUP}</body></html>`);
	const document = dom.window.document;
	initAccountDialogs({ document });

	function element<T extends HTMLElement = HTMLElement>(selector: string, description: string): T {
		const el = document.querySelector<T>(selector);
		assert(el, description);
		return el;
	}

	function dispatchToggle(target: EventTarget, newState: string): void {
		const event = new dom.window.Event("toggle");
		Object.defineProperty(event, "newState", { value: newState });
		target.dispatchEvent(event);
	}

	return {
		document,
		trigger: () => element("[data-test-trigger]", "the dialog's trigger must be in the document"),
		cancel: () => element("[data-test-dialog-cancel]", "the dialog must hold its Cancel"),
		outside: () => element("[data-test-outside]", "an outside control must be in the document"),
		closeDialog: (name: string) =>
			dispatchToggle(element(`[data-test-dialog='${name}']`, `the ${name} dialog must be in the document`), "closed"),
		openDialog: (name: string) =>
			dispatchToggle(element(`[data-test-dialog='${name}']`, `the ${name} dialog must be in the document`), "open"),
		toggleOnDocument: () => dispatchToggle(document, "closed"),
	};
}

describe("initAccountDialogs", () => {
	it("returns focus to the control that opened a dialog closed with focus on the page, not to the dialog's Cancel", () => {
		const app = init();

		app.closeDialog("disconnect");

		expect(app.document.activeElement).toBe(app.trigger());
	});

	it("returns focus to the control that opened a dialog closed with focus still inside it", () => {
		const app = init();
		app.cancel().focus();

		app.closeDialog("disconnect");

		expect(app.document.activeElement).toBe(app.trigger());
	});

	it("leaves focus on a control the reader moved to outside the dialog", () => {
		const app = init();
		app.outside().focus();

		app.closeDialog("disconnect");

		expect(app.document.activeElement).toBe(app.outside());
	});

	it("does nothing while a dialog opens", () => {
		const app = init();

		app.openDialog("disconnect");

		expect(app.document.activeElement).toBe(app.document.body);
	});

	it("does nothing when no control on the page opens the closing dialog", () => {
		const app = init();

		app.closeDialog("orphan");

		expect(app.document.activeElement).toBe(app.document.body);
	});

	it("ignores a toggle that names no element", () => {
		const app = init();

		app.toggleOnDocument();

		expect(app.document.activeElement).toBe(app.document.body);
	});
});
