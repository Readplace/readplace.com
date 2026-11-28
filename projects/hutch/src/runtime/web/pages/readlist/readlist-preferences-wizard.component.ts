import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READLIST_PURPOSE_MAX_LENGTH } from "@packages/domain/readlist";
import { render } from "@packages/web-shell";

import type { WizardStep } from "../../shared/wizard/wizard.types";

const PURPOSE_STEP_TEMPLATE = readFileSync(
	join(__dirname, "readlist-purpose-step.template.html"),
	"utf-8",
);

export interface ReadlistPreferencesWizardViewModel {
	purpose: string;
}

export const READLIST_PREFERENCES_WIZARD_ID = "readlist-preferences-wizard";

export const READLIST_PREFERENCES_WIZARD_KEY = "readlist-preferences";

export const READLIST_PREFERENCES_STEP: WizardStep<ReadlistPreferencesWizardViewModel> = {
	id: "purpose",
	title: "What's this readlist for?",
	description: "Describe what you want to save here. This helps keep your readlist focused.",
	template: ({ values, field }) =>
		render(PURPOSE_STEP_TEMPLATE, {
			purpose: values.purpose ?? "",
			fieldId: `${field.idPrefix}-purpose`,
			errorId: field.errorId,
			invalid: field.invalid,
			autofocus: field.autofocus,
			required: true,
			maxLength: READLIST_PURPOSE_MAX_LENGTH,
		}),
};
