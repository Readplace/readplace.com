import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import {
	READLIST_NAME_FIELD,
	READLIST_NAME_LABEL,
	READLIST_NAME_PLACEHOLDER,
	renderReadlistNameForm,
} from "./readlist-name-form.component";

function nameForm(overrides: Partial<Parameters<typeof renderReadlistNameForm>[0]> = {}): Document {
	return new JSDOM(
		`<div>${renderReadlistNameForm({
			key: "readlist-weekend",
			popoverId: "weekend-dialog",
			action: "/queue/queues/weekend/rename",
			inputId: "weekend-dialog-name",
			value: "Weekend Reads",
			commitLabel: "Save",
			failureMessage: "Couldn't rename the readlist.",
			...overrides,
		})}</div>`,
	).window.document;
}

function formOf(doc: Document): HTMLFormElement {
	const form = doc.querySelector("form");
	assert(form, "the partial must render its form");
	return form;
}

function inputOf(doc: Document): HTMLInputElement {
	const input = doc.querySelector<HTMLInputElement>("[data-test-readlist-weekend-input]");
	assert(input, "the partial must render its name input");
	return input;
}

describe("renderReadlistNameForm", () => {
	it("marks the form for the client script and carries the failure the script shows when the server cannot answer", () => {
		const form = formOf(nameForm());

		expect(form.hasAttribute("data-readlist-name-form")).toBe(true);
		expect(form.getAttribute("data-readlist-name-failure")).toBe("Couldn't rename the readlist.");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe("/queue/queues/weekend/rename");
		expect(form.getAttribute("data-test-form")).toBe("readlist-weekend");
	});

	it("posts through htmx to the same action, swapping only itself and holding one request per dialog", () => {
		const form = formOf(nameForm({ action: "/queue/queues?queue=weekend&utm_source=queue-nav" }));

		expect(form.getAttribute("action")).toBe("/queue/queues?queue=weekend&utm_source=queue-nav");
		expect(form.getAttribute("hx-post")).toBe("/queue/queues?queue=weekend&utm_source=queue-nav");
		expect(form.getAttribute("hx-target")).toBe("this");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");
		expect(form.getAttribute("hx-sync")).toBe("closest [popover]:drop");
	});

	it("opens with a field that is neither invalid nor focused, over an empty error line", () => {
		const doc = nameForm();
		const input = inputOf(doc);

		const error = doc.querySelector("[data-readlist-name-error]");
		assert(error, "the partial must carry its error line");
		expect(input.hasAttribute("aria-invalid")).toBe(false);
		expect(input.hasAttribute("autofocus")).toBe(false);
		expect(error.innerHTML).toBe("");
	});

	it("re-renders a refused name as typed, with the reason under the field and focus back on it", () => {
		const doc = nameForm({
			value: '"Weekend" <b>Reads</b> & more',
			error: "You already have a readlist with that name, so pick another one.",
		});
		const input = inputOf(doc);

		const error = doc.getElementById(input.getAttribute("aria-describedby") ?? "");
		assert(error, "the field must be described by its error line");
		expect(input.value).toBe('"Weekend" <b>Reads</b> & more');
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(input.hasAttribute("autofocus")).toBe(true);
		expect(error.hasAttribute("data-readlist-name-error")).toBe(true);
		expect(error.textContent).toBe("You already have a readlist with that name, so pick another one.");
	});

	it("labels one shared name field, capped at the server's length limit", () => {
		const doc = nameForm();
		const input = inputOf(doc);

		const label = doc.querySelector(`label[for="${input.id}"]`);
		assert(label, "the name input must be labelled");
		expect(label.textContent).toBe(READLIST_NAME_LABEL);
		expect(READLIST_NAME_LABEL).toBe("Readlist name");
		expect(input.id).toBe("weekend-dialog-name");
		expect(input.getAttribute("name")).toBe(READLIST_NAME_FIELD);
		expect(input.getAttribute("value")).toBe("Weekend Reads");
		expect(input.getAttribute("placeholder")).toBe(READLIST_NAME_PLACEHOLDER);
		expect(READLIST_NAME_PLACEHOLDER).toBe("Enter readlist name");
		expect(input.getAttribute("maxlength")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(input.hasAttribute("required")).toBe(true);
	});

	it("describes the field by its error line, which the client script fills", () => {
		const doc = nameForm();
		const input = inputOf(doc);

		const error = doc.querySelector("[data-readlist-name-error]");
		assert(error, "the partial must carry its error line");
		expect(input.getAttribute("aria-describedby")).toBe("weekend-dialog-name-error");
		expect(error.id).toBe("weekend-dialog-name-error");
		expect(error.getAttribute("role")).toBe("alert");
	});

	it("puts Cancel before the commit, which holds its label and the in-flight dots", () => {
		const doc = nameForm();

		const buttons = doc.querySelector(".confirm-popover__buttons");
		assert(buttons, "the partial must render its button row");
		expect([...buttons.children].map((button) => button.getAttribute("data-test-action"))).toEqual([
			"readlist-weekend-cancel",
			"readlist-weekend-save",
		]);
		const [cancel, commit] = [...buttons.children];
		assert(cancel && commit, "the button row must hold Cancel and the commit");
		expect(cancel.getAttribute("popovertarget")).toBe("weekend-dialog");
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
		expect(commit.getAttribute("type")).toBe("submit");
		expect(commit.querySelector(".readlist-name-form__commit-label")?.textContent).toBe("Save");
		expect(commit.querySelectorAll(".readlist-name-form__loader.in-flight-dots")).toHaveLength(1);
	});
});
