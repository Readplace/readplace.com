import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReportArticle } from "./report-article.client";

const BEACON_URL = "/report-article/opened?utm_source=article-report&utm_medium=internal&utm_content=report-open&utm_term=reader";

function setup(bodyHtml: string) {
	const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
	const beacons: string[] = [];
	initReportArticle({ document: dom.window.document, sendBeacon: (url) => beacons.push(url) });
	function toggle(id: string, newState: "open" | "closed"): void {
		const el = dom.window.document.getElementById(id);
		assert(el, `#${id} must exist in the fixture`);
		const event = new dom.window.Event("toggle");
		Object.defineProperty(event, "newState", { value: newState });
		el.dispatchEvent(event);
	}
	function beforeSwap(selector: string, status: number): { shouldSwap: boolean; isError: boolean } {
		const el = dom.window.document.querySelector(selector);
		assert(el, `${selector} must exist in the fixture`);
		const detail = { xhr: { status }, shouldSwap: false, isError: true };
		el.dispatchEvent(new dom.window.CustomEvent("htmx:beforeSwap", { bubbles: true, detail }));
		return { shouldSwap: detail.shouldSwap, isError: detail.isError };
	}
	return { beacons, toggle, beforeSwap };
}

const DIALOG = `<div id="report-article" popover data-beacon-url="${BEACON_URL}"><form data-report-article-form></form></div><div id="other" popover data-beacon-url="/elsewhere"><form id="other-form"></form></div>`;

describe("initReportArticle", () => {
	it("beacons the dialog's tracked URL once when the report dialog opens", () => {
		const page = setup(DIALOG);

		page.toggle("report-article", "open");

		assert.deepEqual(page.beacons, [BEACON_URL]);
	});

	it("sends nothing when the report dialog closes", () => {
		const page = setup(DIALOG);

		page.toggle("report-article", "closed");

		assert.deepEqual(page.beacons, []);
	});

	it("ignores another popover opening", () => {
		const page = setup(DIALOG);

		page.toggle("other", "open");

		assert.deepEqual(page.beacons, []);
	});

	it("sends nothing for a report dialog that carries no beacon URL", () => {
		const page = setup(`<div id="report-article" popover></div>`);

		page.toggle("report-article", "open");

		assert.deepEqual(page.beacons, []);
	});

	it("ignores toggle and swap events whose target is not an element", () => {
		const dom = new JSDOM("<!doctype html><html><body></body></html>");
		const beacons: string[] = [];
		initReportArticle({ document: dom.window.document, sendBeacon: (url) => beacons.push(url) });
		const detail = { xhr: { status: 502 }, shouldSwap: false, isError: true };

		dom.window.document.dispatchEvent(new dom.window.Event("toggle"));
		dom.window.document.dispatchEvent(new dom.window.CustomEvent("htmx:beforeSwap", { detail }));

		assert.deepEqual({ beacons, shouldSwap: detail.shouldSwap }, { beacons: [], shouldSwap: false });
	});

	it("swaps in the form the server re-renders with its error line when the email could not be sent", () => {
		const page = setup(DIALOG);

		assert.deepEqual(page.beforeSwap("[data-report-article-form]", 502), { shouldSwap: true, isError: false });
	});

	it("leaves any other status of the report form to htmx's own handling", () => {
		const page = setup(DIALOG);

		assert.deepEqual(page.beforeSwap("[data-report-article-form]", 400), { shouldSwap: false, isError: true });
	});

	it("leaves another form's failed response alone", () => {
		const page = setup(DIALOG);

		assert.deepEqual(page.beforeSwap("#other-form", 502), { shouldSwap: false, isError: true });
	});
});
