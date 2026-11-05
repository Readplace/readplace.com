import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { FormField } from "./gmail-form-fields";
import type { GmailChecklistAction, GmailChecklistRow, GmailChecklistState } from "./gmail-sender-checklist.viewmodel";
import type { GmailSenderOption, GmailSenderResultsState } from "./gmail-sender-picker.viewmodel";
import type { GmailSenderStatusViewModel } from "./gmail-sender-status.viewmodel";

function template(name: string): string {
	return readFileSync(join(__dirname, name), "utf-8");
}

const GMAIL_SENDER_STATUS_TEMPLATE = template("gmail-sender-status.template.html");
const GMAIL_LOAD_BUTTON_TEMPLATE = template("gmail-load-button.template.html");
const GMAIL_SENDER_CHECKLIST_TEMPLATE = template("gmail-sender-checklist.template.html");
const GMAIL_SENDER_RESULTS_TEMPLATE = template("gmail-sender-results.template.html");
const GMAIL_SENDER_SELECTION_TEMPLATE = template("gmail-sender-selection.template.html");

export interface GmailChecklistView {
	state: GmailChecklistState;
	intro: string;
	message: string;
	groups: readonly { key: string; title: string; rows: readonly GmailChecklistRow[]; actions: readonly { name: string; label: string }[] }[];
	total: number;
	knownCount: number;
	actions: readonly GmailChecklistAction[];
}

export interface GmailSenderResultsView {
	resultsState: GmailSenderResultsState;
	resultsMessage: string;
	refineSearch: boolean;
	options: readonly GmailSenderOption[];
}

export interface GmailSenderWidgetViewModel {
	discoveryAction: string;
	discoveryFields: readonly FormField[];
	pagePath: string;
	searchPath: string;
	senderPicker: { open: boolean; searchAutofocus: boolean };
	search: string;
	searchFields: readonly FormField[];
	status: GmailSenderStatusViewModel;
	checklist: GmailChecklistView;
	results: GmailSenderResultsView;
}

function renderLoadButton(input: { label: string; outOfBand: boolean }): string {
	return render(GMAIL_LOAD_BUTTON_TEMPLATE, input);
}

export function renderGmailSenderStatusHtml(status: GmailSenderStatusViewModel, options: { outOfBandLoadButton: boolean }): string {
	const html = render(GMAIL_SENDER_STATUS_TEMPLATE, status);
	return options.outOfBandLoadButton ? renderLoadButton({ label: status.loadButtonLabel, outOfBand: true }) + html : html;
}

export function renderGmailSenderChecklistHtml(view: GmailChecklistView): string {
	return render(GMAIL_SENDER_CHECKLIST_TEMPLATE, view);
}

export function renderGmailSenderResultsHtml(results: GmailSenderResultsView): string {
	return render(GMAIL_SENDER_RESULTS_TEMPLATE, results);
}

export function renderGmailSenderSelectionHtml(vm: GmailSenderWidgetViewModel & { autoDiscoverHtml: string }): string {
	return render(GMAIL_SENDER_SELECTION_TEMPLATE, {
		...vm,
		loadButton: renderLoadButton({ label: vm.status.loadButtonLabel, outOfBand: false }),
		senderStatus: renderGmailSenderStatusHtml(vm.status, { outOfBandLoadButton: false }),
		senderChecklist: renderGmailSenderChecklistHtml(vm.checklist),
		senderResults: renderGmailSenderResultsHtml(vm.results),
	});
}
