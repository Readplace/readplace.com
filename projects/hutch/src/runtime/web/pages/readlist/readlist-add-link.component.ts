import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SaveableUrlErrorCode } from "@packages/domain/article";
import { AUDIO, BOOK, VIDEO } from "@packages/media-contracts";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import {
	type AlertContent,
	render,
	renderAlert,
	renderConfirmPopover,
	renderNeedsUpgrade,
	withInternalTracking,
} from "@packages/web-shell";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import type { SaveTip } from "../../shared/save-tip/save-tip.component";
import type { ComponentError } from "../../shared/component-error.types";
import { renderUploadDropzone } from "../../shared/upload-dropzone/upload-dropzone.component";
import {
	type UpgradeOffer,
	type UpgradeStanding,
	lockFor,
	standingOf,
} from "../../shared/upgrade-offer/upgrade-offer";
import { DEFAULT_READLIST } from "./readlist.nav";
import { READLIST_SAVE_PATH, readlistReturnQuery, type ReadlistUrlState } from "./readlist.url";
import type { ImportSkippedViewModel } from "./readlist.viewmodel";
import { UPLOAD_ENTRY_HREFS } from "../upload/upload-entry-ctas";

const CONTROL_TEMPLATE = readFileSync(join(__dirname, "readlist-add-link.template.html"), "utf-8");
const FORM_TEMPLATE = readFileSync(join(__dirname, "readlist-add-link-form.template.html"), "utf-8");
const TABS_TEMPLATE = readFileSync(join(__dirname, "readlist-add-link-tabs.template.html"), "utf-8");
const PENDING_TEMPLATE = readFileSync(join(__dirname, "readlist-add-link-pending.template.html"), "utf-8");
const FEEDBACK_TEMPLATE = readFileSync(join(__dirname, "readlist-save-feedback.template.html"), "utf-8");
const SKIPPED_TEMPLATE = readFileSync(join(__dirname, "readlist-save-feedback-skipped.template.html"), "utf-8");

export const ADD_LINK_POPOVER_ID = "add-link";

const ADD_ARTICLE_MODES = [
	{ value: "file", label: "File", checked: true },
	{ value: "link", label: "Link", checked: false },
];

const ADD_LINK_TITLE = "Add article";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

const ADD_LINK_FAILURE = "Couldn't save the link.";

interface Attribute {
	name: string;
	value: string;
}

export interface AddLinkFormError {
	message: string;
	code?: SaveableUrlErrorCode;
}

const ADD_ARTICLE_IMPORT_ACTION = withInternalTracking("/import", { source: "queue-add-article", content: "import" });

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
	offer: UpgradeOffer | undefined;
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
				accessIsReadOnly: input.accessIsReadOnly,
				formHtml: form({ value: input.saveUrl, autoSubmit: true, autofocus: false }),
			}),
		};
	}
	const formControl = (): ReadlistAddLink => ({
		controlHtml: render(CONTROL_TEMPLATE, {
			locks: [],
			forms: [{ action, accessIsReadOnly: input.accessIsReadOnly, bookFallbackHref: UPLOAD_ENTRY_HREFS.addArticleFallback }],
		}),
		dialogHtml: renderConfirmPopover({
			id: ADD_LINK_POPOVER_ID,
			key: ADD_LINK_POPOVER_ID,
			title: ADD_LINK_TITLE,
			body: "",
			actionsHtml: [
				render(TABS_TEMPLATE, {
					modes: ADD_ARTICLE_MODES,
					accessIsReadOnly: input.accessIsReadOnly,
					linkFormHtml: form({ value: "", autoSubmit: false, autofocus: false }),
					dropzoneHtml: renderUploadDropzone({
						importAction: ADD_ARTICLE_IMPORT_ACTION,
						bookFallbackHref: UPLOAD_ENTRY_HREFS.addArticleFallback,
						disabled: input.accessIsReadOnly,
						idPrefix: "add-article",
						formId: "add-article-upload-form",
						showSubmit: false,
						uploadOnChoose: false,
						kinds: [BOOK, AUDIO, VIDEO],
					}),
				}),
				input.saveTip.html,
			].join("\n"),
		}),
		pendingHtml: "",
	});
	const controlByStanding: Record<UpgradeStanding, () => ReadlistAddLink> = {
		open: formControl,
		withheld: formControl,
		"needs-upgrade": () => {
			const lock = lockFor({
				offer: input.offer,
				gated: input.accessIsReadOnly,
				key: "add-link",
				label: t("readlistAddArticle.trigger"),
				controlClass: "btn btn--neutral btn--s",
				source: "queue-add-link",
			});
			assert(lock, "a reader who needs an upgrade must be offered the Upload lock");
			return {
				controlHtml: render(CONTROL_TEMPLATE, { locks: [renderNeedsUpgrade(lock)], forms: [] }),
				dialogHtml: "",
				pendingHtml: "",
			};
		},
	};
	return controlByStanding[standingOf({ gated: input.accessIsReadOnly, offer: input.offer })]();
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
