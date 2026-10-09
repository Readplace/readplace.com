import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderConfirmPopover, renderInFlightDots } from "@packages/web-shell";

import { resolveWizardStep } from "./wizard";
import type { WizardHeading, WizardSteps, WizardSurface } from "./wizard.types";

export { WIZARD_STYLES } from "./wizard.styles";

const FORM_TEMPLATE = readFileSync(join(__dirname, "wizard-form.template.html"), "utf-8");
const INLINE_TEMPLATE = readFileSync(join(__dirname, "wizard-inline.template.html"), "utf-8");

const FORM_CLASS: Record<WizardSurface, string> = {
	popover: "wizard__form confirm-popover__actions",
	inline: "wizard__form",
};

const SUBMIT_ATTRIBUTES: Record<WizardSurface, string> = {
	popover:
		'hx-post="{{action}}" hx-target="this" hx-swap="outerHTML show:none" hx-sync="closest [popover]:drop" data-readlist-name-form data-readlist-name-failure="{{failureMessage}}"',
	inline: 'hx-boost="false"',
};

const CANCEL_TEMPLATE: Record<WizardSurface, string> = {
	popover:
		'<button class="btn btn--neutral" type="button" popovertarget="{{id}}" popovertargetaction="hide" data-test-action="{{cancelTestAction}}">Cancel</button>',
	inline:
		'<a class="btn btn--neutral" href="{{cancelHref}}" data-test-action="{{cancelTestAction}}">Cancel</a>',
};

const BUTTONS_CLASS: Record<WizardSurface, string> = {
	popover: "confirm-popover__buttons",
	inline: "wizard__buttons",
};

const TEST_ACTION_SUFFIX: Record<WizardSurface, string> = {
	popover: "",
	inline: "-fallback",
};

const LOADER_HTML = renderInFlightDots("wizard__save-loader in-flight-dots");

function titlesFor(heading: WizardHeading, question: string): { title: string; subheading?: string } {
	return heading.kind === "task" ? { title: heading.title, subheading: question } : { title: question };
}

export interface WizardRender {
	popoverHtml: string;
	inlineHtml: string;
	popoverFormHtml: string;
}

export function renderWizard<VM extends object>(input: {
	id: string;
	key: string;
	steps: WizardSteps<VM>;
	values: Partial<VM>;
	action: string;
	cancelHref: string;
	submitLabel: string;
	heading: WizardHeading;
	failureMessage: string;
	error?: string;
}): WizardRender {
	const step = resolveWizardStep({ steps: input.steps, values: input.values });
	const invalid = input.error !== undefined;
	const { title, subheading } = titlesFor(input.heading, step.title);

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
			buttonsClass: BUTTONS_CLASS[surface],
			action: input.action,
			failureMessage: input.failureMessage,
			cancelHref: input.cancelHref,
			cancelTestAction: `${input.key}-cancel${suffix}`,
			saveTestAction: `${input.key}-save${suffix}`,
			submitLabel: input.submitLabel,
			errorId,
			error: input.error,
			loaderHtml: LOADER_HTML,
			fieldHtml: step.template({
				values: input.values,
				field: { idPrefix, errorId, invalid },
			}),
		};
		return render(FORM_TEMPLATE, {
			...data,
			submitAttributes: render(SUBMIT_ATTRIBUTES[surface], data),
			cancelHtml: render(CANCEL_TEMPLATE[surface], data),
		});
	};

	const popoverFormHtml = surfaceForm("popover");

	return {
		popoverHtml: renderConfirmPopover({
			id: input.id,
			key: input.key,
			title,
			subheading,
			body: step.description,
			actionsHtml: popoverFormHtml,
		}),
		inlineHtml: render(INLINE_TEMPLATE, {
			key: input.key,
			titleId: `${input.id}-inline-title`,
			title,
			subheadings: subheading === undefined ? [] : [subheading],
			description: step.description,
			formHtml: surfaceForm("inline"),
		}),
		popoverFormHtml,
	};
}
