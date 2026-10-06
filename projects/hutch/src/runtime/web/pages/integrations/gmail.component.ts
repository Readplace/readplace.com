import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert, renderInFlightDots } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { requireEnv } from "@packages/require-env";
import { GMAIL_PAGE_STYLES } from "./gmail.styles";
import { GMAIL_PATH } from "./gmail.url";
import type { GmailForwardingState, GmailMappingDestination, GmailMappingRow, GmailMappingsViewModel } from "./gmail-mappings.viewmodel";
import type { GmailPageViewModel, GmailPollViewModel } from "./gmail.viewmodel";
import { toGmailPollViewModel } from "./gmail.viewmodel";

function template(name: string): string {
	return readFileSync(join(__dirname, name), "utf-8");
}

const GMAIL_TEMPLATE = template("gmail.template.html");
const GMAIL_POLL_TEMPLATE = template("gmail-poll.template.html");
const GMAIL_SENDER_RESULTS_TEMPLATE = template("gmail-sender-results.template.html");
const GMAIL_LOAD_BUTTON_TEMPLATE = template("gmail-load-button.template.html");
const GMAIL_READLIST_PICKER_TEMPLATE = template("gmail-readlist-picker.template.html");
const GMAIL_MAPPING_CHOICE_TEMPLATE = template("gmail-mapping-choice.template.html");
const GMAIL_MAPPINGS_TEMPLATE = template("gmail-mappings.template.html");
const GMAIL_MAPPING_ROW_TEMPLATE = template("gmail-mapping-row.template.html");
const GMAIL_IMPORT_CONSENT_TEMPLATE = template("gmail-import-consent.template.html");

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
	return render(GMAIL_LOAD_BUTTON_TEMPLATE, { label: vm.chooser.loadButtonLabel, outOfBand });
}

function renderMappingChoice(vm: GmailPageViewModel, outOfBand: boolean): string {
	if (vm.selectedSender === undefined) return "";
	return render(GMAIL_MAPPING_CHOICE_TEMPLATE, {
		save: vm.save,
		readlistPicker: vm.readlistPicker,
		delivery: vm.delivery,
		notificationSender: vm.notificationSender,
		outOfBand,
		readlistPickerHtml: render(GMAIL_READLIST_PICKER_TEMPLATE, { ...vm.readlistPicker, submitLoader: SUBMIT_LOADER_HTML }),
		submitLoader: SUBMIT_LOADER_HTML,
	});
}

export function renderGmailSenderResults(
	vm: GmailPageViewModel,
	options: { outOfBandLoadButton: boolean; outOfBandState: boolean } = { outOfBandLoadButton: false, outOfBandState: false },
): string {
	const results = render(GMAIL_SENDER_RESULTS_TEMPLATE, {
		...vm.chooser,
		loadButton: options.outOfBandLoadButton ? renderGmailLoadButton(vm, true) : undefined,
	});
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

function renderMappings(mappings: GmailMappingsViewModel, outOfBand: boolean): string {
	return render(GMAIL_MAPPINGS_TEMPLATE, {
		...mappings,
		outOfBand,
		rowsHtml: mappings.rows.map(renderMappingRow),
		filterMessageHtml: mappings.filter.presentation === "alert"
			? renderAlert({ key: "gmail-filter", content: { variant: "error", message: { text: mappings.filter.message } } })
			: render('<p class="gmail__step-copy" role="status" data-test-gmail-filter-message>{{message}}</p>', { message: mappings.filter.message }),
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
				alertsHtml: vm.alerts.map(({ key, message }) => renderAlert({ key, content: { variant: "error", message: { text: message } } })).join(""),
				noticesHtml: vm.notices.map(({ key, message, variant }) => renderAlert({ key, content: { variant, message: { text: message } } })).join(""),
				settingsShot: SETTINGS_SHOT,
				forwardingShot: FORWARDING_SHOT,
				pollLine:
					vm.pollState === undefined
						? ""
						: renderGmailPoll(toGmailPollViewModel({ pollCount: 0, state: vm.pollState, picker: vm.pickerState })),
				loadButton: renderGmailLoadButton(vm, false),
				senderResults: renderGmailSenderResults(vm),
				mappingChoiceHtml: renderMappingChoice(vm, false),
				mappingsHtml: renderMappings(vm.mappings, false),
			}),
		},
		scripts: GMAIL_COPY_SCRIPT,
	};
}
