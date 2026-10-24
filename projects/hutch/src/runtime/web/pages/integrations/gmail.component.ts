import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert, renderInFlightDots } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { requireEnv } from "@packages/require-env";
import { GMAIL_PAGE_STYLES } from "./gmail.styles";
import { GMAIL_PATH } from "./gmail.url";
import type { GmailAddNewslettersAction, GmailForwardingState, GmailMappingDestination, GmailMappingRow, GmailMappingsViewModel } from "./gmail-mappings.viewmodel";
import type { GmailPageViewModel, GmailPollViewModel } from "./gmail.viewmodel";
import { toGmailPollViewModel } from "./gmail.viewmodel";

function template(name: string): string {
	return readFileSync(join(__dirname, name), "utf-8");
}

const GMAIL_TEMPLATE = template("gmail.template.html");
const GMAIL_POLL_TEMPLATE = template("gmail-poll.template.html");
const GMAIL_SENDER_RESULTS_TEMPLATE = template("gmail-sender-results.template.html");
const GMAIL_SENDER_STATUS_TEMPLATE = template("gmail-sender-status.template.html");
const GMAIL_SENDER_CHECKLIST_TEMPLATE = template("gmail-sender-checklist.template.html");
const GMAIL_LOAD_BUTTON_TEMPLATE = template("gmail-load-button.template.html");
const GMAIL_READLIST_PICKER_TEMPLATE = template("gmail-readlist-picker.template.html");
const GMAIL_MAPPING_CHOICE_TEMPLATE = template("gmail-mapping-choice.template.html");
const GMAIL_MAPPINGS_TEMPLATE = template("gmail-mappings.template.html");
const GMAIL_MAPPING_ROW_TEMPLATE = template("gmail-mapping-row.template.html");
const GMAIL_IMPORT_CONSENT_TEMPLATE = template("gmail-import-consent.template.html");
const GMAIL_DIALOG_TEMPLATE = template("gmail-dialog.template.html");
const GMAIL_DIALOG_BODY_TEMPLATE = template("gmail-dialog-body.template.html");
const GMAIL_SENDER_SELECTION_TEMPLATE = template("gmail-sender-selection.template.html");
const GMAIL_ADD_NEWSLETTERS_TEMPLATE = template("gmail-add-newsletters.template.html");

const DIALOG_AUTO_DISCOVER_TEMPLATE = '<div hidden data-background-request hx-post="{{action}}" hx-trigger="load" hx-target="#gmail-sender-status" hx-select="#gmail-sender-status" hx-select-oob="#gmail-load-senders-button:outerHTML" hx-swap="outerHTML show:none" hx-include="#gmail-sender-search-form, #gmail-sender-search" hx-indicator=".gmail__load" data-test-gmail-auto-load-senders="dialog"></div>';
const PAGE_AUTO_DISCOVER_TEMPLATE = '<div hidden data-background-request hx-post="{{action}}" hx-trigger="load" hx-swap="none" hx-select-oob="#gmail-add-newsletters-form:outerHTML" hx-include="#gmail-add-newsletters-form" data-test-gmail-auto-load-senders="page"></div>';

const GMAIL_COPY_SCRIPT = `<script src="/client-dist/integrations.client.js" defer></script>`;

const SUBMIT_LOADER_HTML = renderInFlightDots("gmail__submit-loader in-flight-dots");

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");

const SETTINGS_SHOT = {
	src: `${STATIC_BASE_URL}/screenshots/gmail-see-all-settings.webp`,
	alt: "Gmail's toolbar with the gear icon circled, and the Quick settings panel below it with See all settings circled",
	width: 1440,
	height: 308,
} as const;

const FORWARDING_SHOT = {
	src: `${STATIC_BASE_URL}/screenshots/gmail-add-forwarding-address.webp`,
	alt: "Gmail's settings tabs with Forwarding and POP/IMAP circled, and the Add a forwarding address button circled",
	width: 1440,
	height: 282,
} as const;

const DESTINATION_CLASSES: Record<GmailMappingDestination["kind"], string> = {
	readlist: "gmail-mappings__destination--readlist",
	unresolved: "gmail-mappings__destination--unresolved",
};

const FORWARDING_CLASSES: Record<GmailForwardingState, string> = {
	live: "gmail-mappings__forwarding--live",
	failed: "gmail-mappings__forwarding--failed",
	pending: "",
	"confirmation-required": "",
};

const ACCOUNT_CLASSES = {
	shown: "gmail__account gmail__account--shown",
	hidden: "gmail__account gmail__account--hidden",
} as const;

export function renderGmailPoll(vm: GmailPollViewModel): string {
	return render(GMAIL_POLL_TEMPLATE, vm);
}

function renderGmailLoadButton(vm: GmailPageViewModel, outOfBand: boolean): string {
	return render(GMAIL_LOAD_BUTTON_TEMPLATE, { label: vm.status.loadButtonLabel, outOfBand });
}

export function renderGmailSenderStatus(vm: GmailPageViewModel, options: { outOfBandLoadButton: boolean }): string {
	const status = render(GMAIL_SENDER_STATUS_TEMPLATE, vm.status);
	return options.outOfBandLoadButton ? renderGmailLoadButton(vm, true) + status : status;
}

export function renderGmailSenderChecklist(vm: GmailPageViewModel): string {
	return render(GMAIL_SENDER_CHECKLIST_TEMPLATE, vm.checklist);
}

function renderMappingChoice(vm: GmailPageViewModel, outOfBand: boolean): string {
	return render(GMAIL_MAPPING_CHOICE_TEMPLATE, {
		dialog: vm.dialog,
		save: vm.save,
		readlistPicker: vm.readlistPicker,
		delivery: vm.delivery,
		notificationSender: vm.notificationSender,
		outOfBand,
		readlistPickerHtml: render(GMAIL_READLIST_PICKER_TEMPLATE, { ...vm.readlistPicker, submitLoader: SUBMIT_LOADER_HTML }),
		submitLoader: SUBMIT_LOADER_HTML,
	});
}

export function renderGmailSenderResults(vm: GmailPageViewModel, options: { outOfBandState: boolean }): string {
	const results = render(GMAIL_SENDER_RESULTS_TEMPLATE, vm.results);
	if (!options.outOfBandState) return results;
	return results + renderMappingChoice(vm, true) + renderMappings(vm.mappings, true);
}

function renderMappingRow(row: GmailMappingRow): string {
	return render(GMAIL_MAPPING_ROW_TEMPLATE, {
		...row,
		destinationClass: DESTINATION_CLASSES[row.destinationKind],
		forwardingClass: FORWARDING_CLASSES[row.forwarding],
		consentHtml: row.consent === undefined ? "" : render(GMAIL_IMPORT_CONSENT_TEMPLATE, row.consent),
	});
}

function renderAddNewsletters(actions: readonly GmailAddNewslettersAction[]): string {
	return actions.map((action) => render(GMAIL_ADD_NEWSLETTERS_TEMPLATE, action)).join("");
}

function renderMappings(mappings: GmailMappingsViewModel, outOfBand: boolean): string {
	return render(GMAIL_MAPPINGS_TEMPLATE, {
		...mappings,
		outOfBand,
		headerActionsHtml: renderAddNewsletters(mappings.headerActions),
		emptyActionsHtml: renderAddNewsletters(mappings.emptyActions),
		rowsHtml: mappings.rows.map(renderMappingRow),
		filterMessageHtml: mappings.filter.presentation === "alert"
			? renderAlert({ key: "gmail-filter", content: { variant: "error", message: { text: mappings.filter.message } } })
			: render('<p class="gmail__step-copy" role="status" data-test-gmail-filter-message>{{message}}</p>', { message: mappings.filter.message }),
	});
}

function renderBanners(input: { alerts: GmailPageViewModel["alerts"]; notices: GmailPageViewModel["notices"] }): { alertsHtml: string; noticesHtml: string } {
	return {
		alertsHtml: input.alerts.map(({ key, message }) => renderAlert({ key, content: { variant: "error", message: { text: message } } })).join(""),
		noticesHtml: input.notices.map(({ key, message, variant }) => renderAlert({ key, content: { variant, message: { text: message } } })).join(""),
	};
}

function renderAutoDiscover(vm: GmailPageViewModel, placement: "dialog" | "page"): string {
	if (vm.autoDiscoverAction === undefined || !vm.showSenders) return "";
	const dialogOpen = vm.dialog.mode !== "none";
	if (dialogOpen !== (placement === "dialog")) return "";
	return render(placement === "dialog" ? DIALOG_AUTO_DISCOVER_TEMPLATE : PAGE_AUTO_DISCOVER_TEMPLATE, { action: vm.autoDiscoverAction });
}

const SENDER_SELECTION_BY_MODE: Record<Exclude<GmailPageViewModel["dialog"]["mode"], "none">, (vm: GmailPageViewModel) => string> = {
	add: (vm) => render(GMAIL_SENDER_SELECTION_TEMPLATE, {
		...vm,
		autoDiscoverHtml: renderAutoDiscover(vm, "dialog"),
		loadButton: renderGmailLoadButton(vm, false),
		senderStatus: renderGmailSenderStatus(vm, { outOfBandLoadButton: false }),
		senderChecklist: renderGmailSenderChecklist(vm),
		senderResults: renderGmailSenderResults(vm, { outOfBandState: false }),
	}),
	edit: () => "",
};

function renderGmailDialog(vm: GmailPageViewModel): string {
	const mode = vm.dialog.mode;
	if (mode === "none") return "";
	return render(GMAIL_DIALOG_TEMPLATE, {
		...vm.dialog,
		bodyHtml: render(GMAIL_DIALOG_BODY_TEMPLATE, {
			createAction: vm.readlistPicker.createAction,
			...renderBanners(vm.dialog),
			senderSelectionHtml: SENDER_SELECTION_BY_MODE[mode](vm),
			mappingChoiceHtml: renderMappingChoice(vm, false),
		}),
	});
}

export function GmailPage(vm: GmailPageViewModel): PageBody {
	const accountState = vm.accountEmail === undefined ? "hidden" : "shown";
	return {
		seo: {
			title: "From Gmail — Readplace",
			description: "Send newsletters from Gmail to your Readplace readlists.",
			canonicalUrl: GMAIL_PATH,
			robots: "noindex, nofollow",
		},
		styles: GMAIL_PAGE_STYLES,
		bodyClass: "page-integrations-gmail",
		content: {
			html: render(GMAIL_TEMPLATE, {
				...vm,
				accountState,
				accountClass: ACCOUNT_CLASSES[accountState],
				...renderBanners(vm),
				settingsShot: SETTINGS_SHOT,
				forwardingShot: FORWARDING_SHOT,
				pollLine:
					vm.pollState === undefined
						? ""
						: renderGmailPoll(toGmailPollViewModel({ pollCount: 0, state: vm.pollState, picker: vm.pickerState })),
				pageAutoDiscoverHtml: renderAutoDiscover(vm, "page"),
				dialogHtml: renderGmailDialog(vm),
				mappingsHtml: renderMappings(vm.mappings, false),
			}),
		},
		scripts: GMAIL_COPY_SCRIPT,
	};
}
