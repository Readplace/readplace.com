import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	READLIST_PURPOSE_DELETE_ID,
	renderPurposeDeleteConfirm,
} from "./readlist-purpose-delete-confirm.component";

const ACTION =
	"/queue/queues/a1b2c3d4/preferences/purpose/delete?utm_source=queue-preferences&utm_medium=internal&utm_content=delete-purpose";

function panel(): Element {
	const doc = new JSDOM(renderPurposeDeleteConfirm({ label: "Work Reading", action: ACTION })).window.document;
	const element = doc.querySelector('[data-test-confirm-popover="readlist-purpose-delete"]');
	assert(element, "the purpose delete confirmation must render its panel");
	return element;
}

describe("renderPurposeDeleteConfirm", () => {
	it("asks before clearing the purpose, from the popover every menu trigger opens", () => {
		const element = panel();

		expect(element.getAttribute("id")).toBe(READLIST_PURPOSE_DELETE_ID);
		expect(element.querySelector(".confirm-popover__title")?.textContent).toBe("Delete this purpose?");
	});

	it("says what stays and what stops being filtered", () => {
		expect(panel().querySelector(".confirm-popover__body")?.textContent).toBe(
			"The readlist and its articles stay. Newsletters saved to it will keep every link until you set a new purpose.",
		);
	});

	it("names the readlist to a screen reader without repeating it visibly", () => {
		const lead = panel().querySelector(`#${READLIST_PURPOSE_DELETE_ID}-lead`);
		assert(lead, "the panel must carry its sr-only lead");

		expect(lead.className).toBe("sr-only");
		expect(lead.textContent).toBe("Readlist: Work Reading");
	});

	it("offers Cancel before Delete purpose, dismissing in place and posting the clear", () => {
		const form = panel().querySelector("form.confirm-popover__buttons");
		assert(form, "the panel must lay its choices on the shell's button row");
		const buttons = Array.from(form.querySelectorAll("button"), (button) => ({
			action: button.getAttribute("data-test-action"),
			className: button.className,
			label: button.textContent,
			target: button.getAttribute("popovertarget"),
			type: button.getAttribute("type"),
		}));

		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(ACTION);
		expect(buttons).toEqual([
			{
				action: "readlist-purpose-delete-cancel",
				className: "btn btn--neutral",
				label: "Cancel",
				target: READLIST_PURPOSE_DELETE_ID,
				type: "button",
			},
			{
				action: "readlist-purpose-delete-confirm",
				className: "btn btn--primary",
				label: "Delete purpose",
				target: null,
				type: "submit",
			},
		]);
	});

	it("swaps the page's main in place, so the reader stays on the tab", () => {
		const form = panel().querySelector("form.confirm-popover__buttons");
		assert(form, "the panel must carry its form");

		expect(
			["hx-boost", "hx-target", "hx-select", "hx-swap"].map((name) => form.getAttribute(name)),
		).toEqual(["true", "main", "main", "outerHTML show:none"]);
	});

	it("leaves the panel without a close control or illustration", () => {
		const element = panel();

		expect(element.querySelectorAll(".confirm-popover__close, .confirm-popover__illustration")).toHaveLength(0);
	});
});
