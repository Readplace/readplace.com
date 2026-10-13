import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SaveableUrlErrorCode } from "@packages/domain/article";
import { type AlertContent, render, renderAlert, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import type { SaveTip } from "../../shared/save-tip/save-tip.component";
import type { ComponentError } from "../../shared/component-error.types";
import { DEFAULT_READLIST } from "./readlist.nav";
import { READLIST_SAVE_PATH, readlistReturnQuery, type ReadlistUrlState } from "./readlist.url";
import type { ImportSkippedViewModel } from "./readlist.viewmodel";

const CONTROL_TEMPLATE = readFileSync(join(__dirname, "readlist-add-link.template.html"), "utf-8");
const FORM_TEMPLATE = readFileSync(join(__dirname, "readlist-add-link-form.template.html"), "utf-8");
const PENDING_TEMPLATE = readFileSync(join(__dirname, "readlist-add-link-pending.template.html"), "utf-8");
const FEEDBACK_TEMPLATE = readFileSync(join(__dirname, "readlist-save-feedback.template.html"), "utf-8");
const SKIPPED_TEMPLATE = readFileSync(join(__dirname, "readlist-save-feedback-skipped.template.html"), "utf-8");

export const ADD_LINK_POPOVER_ID = "add-link";

const ADD_LINK_TITLE = "Add link";

const ADD_LINK_BODY = `Paste an article link to save it to ${DEFAULT_READLIST.label}.`;

const ADD_LINK_FAILURE = "Couldn't save the link.";

interface Attribute {
	name: string;
	value: string;
}

export interface AddLinkFormError {
	message: string;
	code?: SaveableUrlErrorCode;
}

export function addLinkAction(filters: ReadlistUrlState): string {
	return withInternalTracking(
		`${READLIST_SAVE_PATH}${readlistReturnQuery({ ...filters, readlist: DEFAULT_READLIST.slug, discovery: undefined })}`,
		{ source: "queue", content: "save" },
	);
}

function errorAttributes(error: AddLinkFormError | undefined): Attribute[] {
	if (error === undefined) return [];
	const attributes = [{ name: "data-test-save-error", value: "" }];
	if (error.code !== undefined) attributes.push({ name: "data-test-saveable-url-code", value: error.code });
	return attributes;
}

export function renderAddLinkForm(input: {
	action: string;
	value: string;
	error?: AddLinkFormError;
	saveTipState: SaveTipState;
	accessIsReadOnly: boolean;
	autoSubmit: boolean;
	autofocus: boolean;
}): string {
	return render(FORM_TEMPLATE, {
		...input,
		error: input.error?.message,
		errorAttributes: errorAttributes(input.error),
		failureMessage: ADD_LINK_FAILURE,
	});
}

export interface ReadlistAddLink {
	controlHtml: string;
	dialogHtml: string;
	pendingHtml: string;
}

export const NO_ADD_LINK: ReadlistAddLink = { controlHtml: "", dialogHtml: "", pendingHtml: "" };

export function renderReadlistAddLink(input: {
	filters: ReadlistUrlState;
	accessIsReadOnly: boolean;
	saveTip: SaveTip;
	saveUrl?: string;
}): ReadlistAddLink {
	const action = addLinkAction(input.filters);
	const form = (surface: { value: string; autoSubmit: boolean; autofocus: boolean }) =>
		renderAddLinkForm({
			action,
			saveTipState: input.saveTip.state,
			accessIsReadOnly: input.accessIsReadOnly,
			...surface,
		});
	if (input.saveUrl !== undefined) {
		return {
			controlHtml: "",
			dialogHtml: "",
			pendingHtml: render(PENDING_TEMPLATE, {
				title: ADD_LINK_TITLE,
				body: ADD_LINK_BODY,
				formHtml: form({ value: input.saveUrl, autoSubmit: true, autofocus: false }),
			}),
		};
	}
	return {
		controlHtml: render(CONTROL_TEMPLATE, { action, accessIsReadOnly: input.accessIsReadOnly }),
		dialogHtml: renderConfirmPopover({
			id: ADD_LINK_POPOVER_ID,
			key: ADD_LINK_POPOVER_ID,
			title: ADD_LINK_TITLE,
			body: ADD_LINK_BODY,
			actionsHtml: `${form({ value: "", autoSubmit: false, autofocus: true })}\n${input.saveTip.html}`,
		}),
		pendingHtml: "",
	};
}

interface FeedbackItem {
	attributes: Attribute[];
	html: string;
}

function saveErrorItem(error: ComponentError | undefined, code: SaveableUrlErrorCode | undefined): FeedbackItem[] {
	if (!error?.message) return [];
	return [
		{
			attributes: errorAttributes({ message: error.message, code }),
			html: renderAlert({
				key: "save-link-error",
				content: {
					variant: "error",
					title: { text: "Couldn't save the link", element: "p" },
					message: { text: error.message },
				},
			}),
		},
	];
}

function importFlashItem(importFlash: string | undefined): FeedbackItem[] {
	if (importFlash === undefined) return [];
	const content: AlertContent = { variant: "info", message: { text: importFlash } };
	return [{ attributes: [{ name: "data-test-import-flash", value: "" }], html: renderAlert({ key: "import-result", content }) }];
}

function importSkippedItem(skipped: ImportSkippedViewModel | undefined): FeedbackItem[] {
	if (skipped === undefined || skipped.entries.length === 0) return [];
	return [
		{
			attributes: [{ name: "data-test-import-skipped", value: "" }],
			html: renderAlert({
				key: "import-skipped",
				content: {
					variant: "error",
					title: { text: "Some links couldn't be imported", element: "p" },
					message: { html: render(SKIPPED_TEMPLATE, skipped) },
				},
			}),
		},
	];
}

export function renderReadlistSaveFeedback(input: {
	errors?: ComponentError[];
	saveErrorCode?: SaveableUrlErrorCode;
	importFlash?: string;
	importSkipped?: ImportSkippedViewModel;
}): string {
	return render(FEEDBACK_TEMPLATE, {
		items: [
			...saveErrorItem(input.errors?.[0], input.saveErrorCode),
			...importFlashItem(input.importFlash),
			...importSkippedItem(input.importSkipped),
		],
	});
}
