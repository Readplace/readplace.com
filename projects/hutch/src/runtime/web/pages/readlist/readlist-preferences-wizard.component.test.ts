import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { READLIST_PREFERENCES_STEPS } from "./readlist-preferences-wizard.component";

interface FieldState {
	invalid: boolean;
	autofocus: boolean;
}

const UNTOUCHED: FieldState = { invalid: false, autofocus: false };

function purposeStepDocument({ invalid, autofocus }: FieldState): Document {
	const [purposeStep] = READLIST_PREFERENCES_STEPS;
	const html = purposeStep.template({
		values: { purpose: "Shipping essays." },
		field: { idPrefix: "prefs-popover", errorId: "prefs-popover-error", invalid, autofocus },
	});
	return new JSDOM(html).window.document;
}

function purposeField(state: FieldState): Element {
	const field = purposeStepDocument(state).querySelector('[name="purpose"]');
	assert(field, "the purpose step must render its purpose field");
	return field;
}

describe("READLIST_PREFERENCES_STEPS purpose step", () => {
	it("asks what the readlist is for and says why it helps", () => {
		const [purposeStep] = READLIST_PREFERENCES_STEPS;

		expect(purposeStep.title).toBe("What's this readlist for?");
		expect(purposeStep.description).toBe(
			"Describe what you want to save here. This helps keep your readlist focused.",
		);
	});

	it("labels the purpose field visibly, so the reader knows what the box holds", () => {
		const doc = purposeStepDocument(UNTOUCHED);
		const label = doc.querySelector("label.form-field__label");
		assert(label, "the purpose step must render a visible label");

		expect(label.textContent).toBe("Readlist purpose");
		expect(label.getAttribute("for")).toBe(purposeField(UNTOUCHED).getAttribute("id"));
	});

	it("draws the purpose field as the shared multiline input, four rows tall", () => {
		const field = purposeField(UNTOUCHED);

		expect(field.className).toBe("form-input form-input--multiline");
		expect(field.getAttribute("rows")).toBe("4");
	});

	it("starts the sentence for the reader, ending in a single ellipsis", () => {
		expect(purposeField(UNTOUCHED).getAttribute("placeholder")).toBe("This readlist purpose is…");
	});

	it("points the purpose field at the wizard's error paragraph", () => {
		expect(purposeField(UNTOUCHED).getAttribute("aria-describedby")).toBe("prefs-popover-error");
	});

	it("leaves the purpose field unmarked while the answer is acceptable", () => {
		const field = purposeField(UNTOUCHED);

		expect(field.hasAttribute("aria-invalid")).toBe(false);
		expect(field.hasAttribute("autofocus")).toBe(false);
	});

	it("marks the purpose field invalid when the answer was refused", () => {
		const field = purposeField({ invalid: true, autofocus: false });

		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(field.hasAttribute("autofocus")).toBe(false);
	});

	it("hands the purpose field focus when the wizard asks for it, refused or not", () => {
		const opened = purposeField({ invalid: false, autofocus: true });
		const refused = purposeField({ invalid: true, autofocus: true });

		expect(opened.hasAttribute("autofocus")).toBe(true);
		expect(opened.hasAttribute("aria-invalid")).toBe(false);
		expect(refused.hasAttribute("autofocus")).toBe(true);
	});
});
