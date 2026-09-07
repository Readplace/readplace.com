import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderConfirmPopover } from "@packages/web-shell";

import { resolveWizardStep } from "./wizard";
import type { WizardSteps, WizardSurface } from "./wizard.types";

export { WIZARD_STYLES } from "./wizard.styles";

const FORM_TEMPLATE = readFileSync(join(__dirname, "wizard-form.template.html"), "utf-8");
const INLINE_TEMPLATE = readFileSync(join(__dirname, "wizard-inline.template.html"), "utf-8");

const FORM_CLASS: Record<WizardSurface, string> = {
	popover: "wizard__form confirm-popover__actions",
	inline: "wizard__form",
};

const CANCEL_TEMPLATE: Record<WizardSurface, string> = {
	popover:
		'<button class="btn btn--secondary" type="button" popovertarget="{{id}}" popovertargetaction="hide" data-test-action="{{cancelTestAction}}">Cancel</button>',
	inline:
		'<a class="btn btn--secondary" href="{{cancelHref}}" data-test-action="{{cancelTestAction}}">Cancel</a>',
};

const TEST_ACTION_SUFFIX: Record<WizardSurface, string> = {
	popover: "",
	inline: "-fallback",
};

const ERROR_CLASS: Record<"visible" | "hidden", string> = {
	visible: "wizard__error wizard__error--visible",
	hidden: "wizard__error wizard__error--hidden",
};

export interface WizardRender {
	popoverHtml: string;
	inlineHtml: string;
}

export function renderWizard<VM extends object>(input: {
	id: string;
	key: string;
	steps: WizardSteps<VM>;
	values: Partial<VM>;
	action: string;
	cancelHref: string;
	submitLabel: string;
	error?: string;
}): WizardRender {
	const step = resolveWizardStep({ steps: input.steps, values: input.values });
	const invalid = input.error !== undefined;

	const surfaceForm = (surface: WizardSurface): string => {
		const idPrefix = `${input.id}-${surface}`;
		const errorId = `${idPrefix}-error`;
		const suffix = TEST_ACTION_SUFFIX[surface];
		const data = {
			id: input.id,
			key: input.key,
			stepId: step.id,
			surface,
			formClass: FORM_CLASS[surface],
			action: input.action,
			cancelHref: input.cancelHref,
			cancelTestAction: `${input.key}-cancel${suffix}`,
			saveTestAction: `${input.key}-save${suffix}`,
			submitLabel: input.submitLabel,
			errorId,
			errorClass: invalid ? ERROR_CLASS.visible : ERROR_CLASS.hidden,
			error: input.error,
			fieldHtml: step.template({
				values: input.values,
				field: { idPrefix, errorId, invalid },
			}),
		};
		return render(FORM_TEMPLATE, {
			...data,
			cancelHtml: render(CANCEL_TEMPLATE[surface], data),
		});
	};

	return {
		popoverHtml: renderConfirmPopover({
			id: input.id,
			key: input.key,
			title: step.title,
			body: step.description,
			actionsHtml: surfaceForm("popover"),
		}),
		inlineHtml: render(INLINE_TEMPLATE, {
			key: input.key,
			titleId: `${input.id}-inline-title`,
			title: step.title,
			description: step.description,
			formHtml: surfaceForm("inline"),
		}),
	};
}
