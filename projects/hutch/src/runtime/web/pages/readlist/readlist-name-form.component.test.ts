import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import {
	READLIST_NAME_FIELD,
	READLIST_NAME_LABEL,
	READLIST_NAME_PLACEHOLDER,
	renderReadlistNameForm,
} from "./readlist-name-form.component";

function nameForm(): Document {
	return new JSDOM(
		`<div>${renderReadlistNameForm({
			key: "readlist-weekend",
			popoverId: "weekend-dialog",
			action: "/queue/queues/weekend/rename",
			inputId: "weekend-dialog-name",
			value: "Weekend Reads",
			commitLabel: "Save",
			failureMessage: "Couldn't rename the readlist.",
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
