import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READLIST_PURPOSE_MAX_LENGTH } from "@packages/domain/readlist";
import { render } from "@packages/web-shell";

import { defineWizardStep, type WizardSteps } from "../../shared/wizard/wizard.types";

const PURPOSE_STEP_TEMPLATE = readFileSync(
	join(__dirname, "readlist-purpose-step.template.html"),
	"utf-8",
);

export interface ReadlistPreferencesWizardViewModel {
	purpose: string;
}

export const READLIST_PREFERENCES_WIZARD_ID = "readlist-preferences-wizard";

export const READLIST_PREFERENCES_WIZARD_KEY = "readlist-preferences";

const step = defineWizardStep<ReadlistPreferencesWizardViewModel>();

export const READLIST_PREFERENCES_STEPS: WizardSteps<ReadlistPreferencesWizardViewModel> = [
	step({
		id: "purpose",
		title: "What's the purpose of this readlist?",
		description: "A sentence or two on what you keep here.",
		viewModel: ["purpose"],
		template: ({ values, field }) =>
			render(PURPOSE_STEP_TEMPLATE, {
				purpose: values.purpose ?? "",
				fieldId: `${field.idPrefix}-purpose`,
				errorId: field.errorId,
				invalid: field.invalid,
				maxLength: READLIST_PURPOSE_MAX_LENGTH,
			}),
	}),
];
