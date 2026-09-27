import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { READLIST_PREFERENCES_STEPS } from "./readlist-preferences-wizard.component";

function purposeField(invalid: boolean): Element {
	const [purposeStep] = READLIST_PREFERENCES_STEPS;
	const html = purposeStep.template({
		values: { purpose: "Shipping essays." },
		field: { idPrefix: "prefs-popover", errorId: "prefs-popover-error", invalid },
	});
	const field = new JSDOM(html).window.document.querySelector('[name="purpose"]');
	assert(field, "the purpose step must render its purpose field");
	return field;
}

describe("READLIST_PREFERENCES_STEPS purpose step", () => {
	it("draws the purpose field as the shared multiline input", () => {
		expect(purposeField(false).className).toBe("form-input form-input--multiline");
	});

	it("points the purpose field at the wizard's error paragraph", () => {
		expect(purposeField(false).getAttribute("aria-describedby")).toBe("prefs-popover-error");
	});

	it("leaves the purpose field unmarked while the answer is acceptable", () => {
		expect(purposeField(false).hasAttribute("aria-invalid")).toBe(false);
	});

	it("marks the purpose field invalid when the answer was refused", () => {
		expect(purposeField(true).getAttribute("aria-invalid")).toBe("true");
	});
});
