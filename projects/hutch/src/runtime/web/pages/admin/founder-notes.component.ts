import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AlertVariant, type PageBody, render, renderAlert } from "@packages/web-shell";
import type { ComponentError } from "../../shared/component-error.types";
import { EXTEND_TRIAL_STYLES } from "./extend-trial.styles";
import { FOUNDER_NOTE_CHOICES, type FounderNoteFormFields } from "./founder-notes.schema";

const TEMPLATE = readFileSync(join(__dirname, "founder-notes.template.html"), "utf-8");

const NOTE_LABELS: Record<(typeof FOUNDER_NOTE_CHOICES)[number], string> = {
	"day-1": "Day 1",
	"day-12": "Day 12",
};

type FounderNotesAlert = { variant: AlertVariant; text: string };

export interface FounderNotesViewModel {
	form: FounderNoteFormFields;
	errors: ComponentError[];
	alerts: FounderNotesAlert[];
}

export function AdminFounderNotesPage(
	viewModel: FounderNotesViewModel,
	options: { statusCode: number },
): PageBody {
	const errorFor = (fieldName: string) =>
		viewModel.errors.find((error) => error.fieldName === fieldName)?.message;
	return {
		seo: {
			title: "Founder notes | Readplace",
			description: "Operator endpoint. Not for public consumption.",
			canonicalUrl: "/admin/founder-notes",
			robots: "noindex, nofollow",
		},
		styles: EXTEND_TRIAL_STYLES,
		bodyClass: "page-admin-founder-notes",
		content: {
			html: render(TEMPLATE, {
				...viewModel.form,
				emailError: errorFor("email"),
				noteError: errorFor("note"),
				sentAtError: errorFor("sentAt"),
				notes: FOUNDER_NOTE_CHOICES.map((value) => ({
					value,
					label: NOTE_LABELS[value],
					selected: value === viewModel.form.note,
				})),
				alertsHtml: viewModel.alerts
					.map((alert) =>
						renderAlert({
							key: "founder-notes",
							content: { variant: alert.variant, title: { text: alert.text, element: "p" } },
						}),
					)
					.join(""),
			}),
		},
		statusCode: options.statusCode,
	};
}
