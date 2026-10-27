import type { AlertVariant } from "@packages/web-shell";
import type {
	DiscoveredGmailSender,
	ForwardableSender,
	GmailConfirmFailureReason,
	GmailConnection,
	GmailConnectionState,
	GmailDeliveryMode,
	GmailDiscovery,
	GmailHistoryImportJob,
	GmailMapping,
} from "@packages/domain/gmail";
import { gmailConnectionState, pickerDeliveryMode } from "@packages/domain/gmail";
import type { InboxAddressEntry } from "@packages/domain/inbox";
import type { NewsletterDetection } from "@packages/domain/newsletter-catalog";
import {
	DEFAULT_READLIST,
	DEFAULT_READLIST_SLUG,
	READLIST_LABEL_MAX_LENGTH,
	READLIST_MAX_PER_USER,
	type ReadlistRef,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { INTEGRATIONS_PATH } from "./gmail-connect.url";
import { GMAIL_UPGRADE_MESSAGE } from "./gmail-connection-access";
import { type GmailConnectionPrompt, gmailConnectionPrompt } from "./gmail-connection-prompt";
import { GMAIL_DELIVERY_COPY } from "./gmail-delivery-copy";
import { type FormField, type GmailFormAction, gmailBodyFields, gmailGetFields, trackGmail } from "./gmail-form-fields";
import { gmailMappingDestination, type GmailMappingsViewModel, toGmailMappingsViewModel } from "./gmail-mappings.viewmodel";
import { type GmailChecklistCommand, type GmailChecklistGroup, type GmailSenderChecklist, toGmailSenderChecklist } from "./gmail-sender-checklist.viewmodel";
import {
	type GmailSenderCandidate,
	type GmailSenderOption,
	type GmailSenderResultsState,
	gmailSenderCandidates,
	gmailSenderName,
	toGmailSenderResults,
} from "./gmail-sender-picker.viewmodel";
import {
	buildGmailMailboxUrl,
	buildGmailUrl,
	buildGmailStatusUrl,
	GMAIL_CONFIRM_MAX_POLLS,
	GMAIL_DISCONNECT_PATH,
	GMAIL_DISCOVERY_FAST_POLLS,
	GMAIL_DISCOVERY_MAX_POLLS,
	GMAIL_DISCOVERY_START_PATH,
	GMAIL_PATH,
	GMAIL_READLIST_CREATE_PATH,
	GMAIL_SENDER_ADD_PATH,
	GMAIL_SENDERS_PATH,
	gmailSelectedReadlists,
	type GmailPageError,
	type GmailPageNotice,
	type GmailPickerState,
	type GmailPollState,
} from "./gmail.url";

export interface GmailBannerViewModel { key: string; message: string }
export interface GmailNoticeViewModel extends GmailBannerViewModel { variant: AlertVariant }

export interface GmailPageInput {
	userId: UserId;
	canConnectGmail: boolean;
	connection: GmailConnection;
	senders: readonly GmailMapping[];
	destinations: ReadonlyMap<string, InboxAddressEntry>;
	readlists: readonly ReadlistRef[];
	readlistLimitReached: boolean;
	gatewayLive: boolean;
	metadataScopeGranted: boolean;
	readScopeGranted: boolean;
	modifyScopeGranted: boolean;
	discoveredSenders: readonly DiscoveredGmailSender[];
	discovery: {
		state: "idle" | GmailDiscovery["state"];
		mode: GmailDiscovery["mode"];
		checkedMessageCount: number;
		requiresReconnect?: boolean;
	};
	detection: NewsletterDetection;
	imports: readonly GmailHistoryImportJob[];
	state: GmailPickerState;
	command: GmailChecklistCommand;
	listed: number | undefined;
	discoveryStarted: boolean;
	discoveryPending: boolean;
	pollCount: number;
	importsPollCount: number;
	error: string | undefined;
	notice: string | undefined;
	saved: number | undefined;
	notification?: boolean;
	focusOnOpen: boolean;
}

export type GmailDialogMode = "none" | "add" | "edit";

interface GmailSenderStatusViewModel {
	discoveryState: string;
	discoveryAfter: string | undefined;
	statusLead: string;
	checkedLabel: string | undefined;
	loadButtonLabel: string;
	reconnectActions: GmailFormAction[];
	refreshActions: { label: string }[];
	pollUrl: string | undefined;
	pollTrigger: string | undefined;
}

interface GmailSenderResultsViewModel {
	resultsState: GmailSenderResultsState;
	resultsMessage: string;
	refineSearch: boolean;
	options: GmailSenderOption[];
}

interface GmailReadlistOption { slug: string; label: string; selected: boolean; locked: boolean }

interface GmailReadlistPickerViewModel {
	open: boolean;
	choiceLabel: string;
	options: GmailReadlistOption[];
	pagePath: string;
	canCreate: boolean;
	createAction: string;
	fields: FormField[];
	confirmLabel: string;
	readlistName: string;
	nameMaxLength: number;
	limitMessage: string;
}

interface GmailSaveViewModel {
	action: string;
	offerImport: boolean;
	importChecked: boolean;
	disabled: boolean;
	autofocus: boolean;
}

interface GmailSenderPickerViewModel {
	open: boolean;
	searchAutofocus: boolean;
}

interface GmailDialogViewModel {
	mode: GmailDialogMode;
	key: string;
	title: string;
	opener: string;
	closeHref: string;
	cancelHref: string;
	senderFields: FormField[];
	alerts: GmailBannerViewModel[];
	notices: GmailNoticeViewModel[];
}

interface GmailDeliveryOption {
	value: GmailDeliveryMode;
	label: string;
	description: string;
	checked: boolean;
}

interface GmailDeliveryChoiceViewModel {
	options: GmailDeliveryOption[];
}

export interface GmailPageViewModel {
	state: GmailConnectionState;
	stateModifier: string;
	statusLabel: string;
	accountEmail: string | undefined;
	pollState: GmailPollState | undefined;
	integrationsPath: string;
	gatewayAddress: string;
	mailboxUrl: string;
	pagePath: string;
	pageUrl: string;
	pickerState: GmailPickerState;
	searchPath: string;
	discoveryAction: string;
	discoveryFields: FormField[];
	disconnectAction: string;
	reconnect: GmailConnectionPrompt;
	metadataReconnect: GmailConnectionPrompt;
	labelPermission: GmailConnectionPrompt | undefined;
	showStep: boolean;
	showSenders: boolean;
	showReconnect: boolean;
	showMetadataReconnect: boolean;
	autoDiscoverAction: string | undefined;
	dialog: GmailDialogViewModel;
	senderPicker: GmailSenderPickerViewModel;
	search: string;
	searchFields: FormField[];
	notificationSender: string | undefined;
	status: GmailSenderStatusViewModel;
	checklist: GmailSenderChecklist;
	results: GmailSenderResultsViewModel;
	readlistPicker: GmailReadlistPickerViewModel;
	delivery: GmailDeliveryChoiceViewModel;
	save: GmailSaveViewModel;
	mappings: GmailMappingsViewModel;
	alerts: GmailBannerViewModel[];
	notices: GmailNoticeViewModel[];
}

export interface GmailPollViewModel { pollUrl: string | undefined; message: string }

const STATUS_LABELS: Record<GmailConnectionState, string> = {
	disconnected: "Not connected", disconnecting: "Disconnecting…", revoked: "Reconnect needed",
	"filter-failed": "Needs attention", "confirm-failed": "Needs attention",
	"awaiting-confirmation": "Step 2 of 2",
	"ready-to-filter": "Not forwarding yet", filtering: "Forwarding",
};

const GMAIL_POLL_STATE_BY_STATE: Record<GmailConnectionState, GmailPollState | undefined> = {
	disconnected: undefined, disconnecting: undefined, revoked: undefined,
	"filter-failed": undefined, "confirm-failed": "confirm-failed",
	"awaiting-confirmation": "awaiting-confirmation",
	"ready-to-filter": undefined, filtering: undefined,
};

export function gmailPollState(state: GmailConnectionState): GmailPollState | undefined {
	return GMAIL_POLL_STATE_BY_STATE[state];
}

export const GMAIL_PAGE_ERRORS: Record<GmailPageError, string> = {
	sender_invalid: "Tick at least one newsletter to save.",
	sender_unknown: "I couldn't find one of those senders. Load your Gmail senders and try again.",
	metadata_required: "Reconnect Gmail to choose senders from your mailbox.",
	readlist_invalid: "Choose your readlists. All is always included.",
	readlist_choice_required: "Confirm the readlists for this newsletter before saving.",
	readlist_name_invalid: `Give the readlist a name of up to ${READLIST_LABEL_MAX_LENGTH} characters.`,
	readlist_limit: `You can keep up to ${READLIST_MAX_PER_USER} readlists. Choose an existing readlist.`,
	import_in_progress: "An import for this newsletter is already underway. Wait for it to finish, or cancel it first.",
	import_unavailable: "Unread messages can't be imported for this newsletter yet. Choose a readlist for it, then try again.",
	import_reconnect_required: "Readplace doesn't know which Gmail account this connection belongs to, so it can't import unread messages. Disconnect Gmail below and connect it again to import them.",
	import_revoked: "Google ended the connection, so Readplace can't import unread messages. Reconnect Gmail to import them.",
};

export const GMAIL_GATEWAY_DISABLED_MESSAGE =
	"This forwarding address has been switched off, so Gmail can't deliver to it. Disconnect Gmail below, then connect again to get a working one.";

export const GMAIL_CONFIRM_FAILED_MESSAGES: Record<GmailConfirmFailureReason, string> = {
	"token-rejected":
		"Google's confirmation link had already been used or had expired by the time I opened it. In Gmail, remove the forwarding address and add it again, and Google will send a fresh one. I'll confirm it as soon as it arrives.",
	"not-confirmed":
		"I opened Google's confirmation link, but Google didn't finish confirming the address. In Gmail, remove the forwarding address and add it again so Google sends a new link.",
	"invalid-url":
		"Google's confirmation email arrived without a link I could use. In Gmail, remove the forwarding address and add it again. If that doesn't help, disconnect Gmail below and connect again.",
};

export const GMAIL_PAGE_NOTICES: Record<GmailPageNotice, { message: string; awaitingConfirmation?: string; variant: AlertVariant }> = {
	connected: { message: "Gmail is connected.", variant: "success" },
	confirmed: { message: "Forwarding confirmed.", variant: "success" },
	sender_removed: { message: "Newsletter removed. Articles you already saved stay in your readlists.", variant: "success" },
	sender_mapped: {
		message: "Newsletter added. Gmail will forward its new issues, and what you chose to save goes to All and any readlists you picked.",
		awaitingConfirmation: "Newsletter added. Its new issues will be forwarded once Gmail confirms the forwarding address.",
		variant: "success",
	},
	sender_remapped: {
		message: "Newsletter updated. From its next issue, what you chose to save goes to All and any readlists you picked.",
		awaitingConfirmation: "Newsletter updated. Its new issues will be forwarded once Gmail confirms the forwarding address.",
		variant: "success",
	},
	senders_saved: {
		message: "{count} newsletters saved. Gmail will forward their new issues, and what you chose to save goes to All and any readlists you picked.",
		awaitingConfirmation: "{count} newsletters saved. Their new issues will be forwarded once Gmail confirms the forwarding address.",
		variant: "success",
	},
	readlist_created: { message: "Readlist created. Save the newsletter to use it.", variant: "success" },
	readlist_reused: { message: "You already have a readlist with that name, so I chose it.", variant: "info" },
	import_started: { message: "Importing unread messages from the last 30 days.", variant: "success" },
	import_permission_needed: { message: "To import unread messages, give Readplace permission to read them in Gmail and to label and mark read the ones it saves.", variant: "info" },
	import_permission_refused: { message: "Google didn't grant permission to read your messages, so the import is waiting. New mail still forwards.", variant: "warning" },
	import_permission_granted: { message: "Readplace can now read your Gmail messages and label the ones it saves. Start the import from the newsletter below.", variant: "success" },
	label_permission_granted: { message: "Readplace will now label saved newsletters imported-to-readplace and mark them read in Gmail, including the ones already waiting.", variant: "success" },
	label_permission_refused: { message: "Google didn't grant permission to label your messages. Newsletters still save to Readplace, and the labelling waits until you allow it.", variant: "warning" },
	import_cancelled: { message: "Import cancelled. Messages already imported stay in your readlists.", variant: "success" },
	filter_retry_requested: { message: "Updating Gmail. Refresh in a moment.", variant: "info" },
};

const READLIST_PICKER_ERRORS: ReadonlySet<string> = new Set(["readlist_invalid", "readlist_name_invalid", "readlist_limit"]);

type GmailBannerSurface = "dialog" | "page";

const GMAIL_ERROR_SURFACES: Record<GmailPageError, GmailBannerSurface> = {
	sender_invalid: "dialog",
	sender_unknown: "dialog",
	metadata_required: "page",
	readlist_invalid: "dialog",
	readlist_choice_required: "dialog",
	readlist_name_invalid: "dialog",
	readlist_limit: "dialog",
	import_in_progress: "page",
	import_unavailable: "page",
	import_reconnect_required: "page",
	import_revoked: "page",
};

const GMAIL_NOTICE_SURFACES: Record<GmailPageNotice, GmailBannerSurface> = {
	connected: "page",
	confirmed: "page",
	sender_removed: "page",
	sender_mapped: "page",
	sender_remapped: "page",
	senders_saved: "page",
	readlist_created: "dialog",
	readlist_reused: "dialog",
	import_started: "page",
	import_permission_needed: "page",
	import_permission_refused: "page",
	import_permission_granted: "page",
	import_cancelled: "page",
	label_permission_granted: "page",
	label_permission_refused: "page",
	filter_retry_requested: "page",
};

function isGmailPageError(key: string | undefined): key is GmailPageError {
	return key !== undefined && Object.hasOwn(GMAIL_ERROR_SURFACES, key);
}

function isGmailPageNotice(key: string | undefined): key is GmailPageNotice {
	return key !== undefined && Object.hasOwn(GMAIL_NOTICE_SURFACES, key);
}

interface GmailBannerKeys {
	error: GmailPageError | undefined;
	notice: GmailPageNotice | undefined;
}

function bannerKeys(input: { error: string | undefined; notice: string | undefined; mode: GmailDialogMode }): Record<GmailBannerSurface, GmailBannerKeys> {
	const error = isGmailPageError(input.error) ? input.error : undefined;
	const notice = isGmailPageNotice(input.notice) ? input.notice : undefined;
	const open = input.mode !== "none";
	const errorOnDialog = open && error !== undefined && GMAIL_ERROR_SURFACES[error] === "dialog";
	const noticeOnDialog = open && notice !== undefined && GMAIL_NOTICE_SURFACES[notice] === "dialog";
	return {
		dialog: { error: errorOnDialog ? error : undefined, notice: noticeOnDialog ? notice : undefined },
		page: { error: errorOnDialog ? undefined : error, notice: noticeOnDialog ? undefined : notice },
	};
}

function errorBanners(key: string | undefined): GmailBannerViewModel[] {
	return Object.entries(GMAIL_PAGE_ERRORS)
		.filter(([errorKey]) => errorKey === key)
		.map(([errorKey, message]) => ({ key: errorKey, message }));
}

function noticeBanners(input: { key: string | undefined; awaitingConfirmation: boolean; saved: number | undefined }): GmailNoticeViewModel[] {
	return Object.entries(GMAIL_PAGE_NOTICES)
		.filter(([noticeKey, notice]) => noticeKey === input.key && (input.saved !== undefined || !notice.message.includes("{count}")))
		.map(([noticeKey, notice]) => ({
			key: noticeKey,
			message: (input.awaitingConfirmation ? notice.awaitingConfirmation ?? notice.message : notice.message).replace("{count}", String(input.saved)),
			variant: notice.variant,
		}));
}

function checkedLabel(count: number, suffix: string): string {
	return `Checked ${count.toLocaleString("en")} ${count === 1 ? "message" : "messages"}${suffix}`;
}

function checkingForNewMessages(input: GmailPageInput): boolean {
	return input.discovery.mode === "history" || (input.discoveryPending && input.discovery.state === "complete");
}

function discoveryStatus(input: GmailPageInput, discovering: boolean): { lead: string; checked: string | undefined } {
	const count = input.discovery.checkedMessageCount;
	if (input.discovery.requiresReconnect) {
		return { lead: input.canConnectGmail ? "Reconnect Gmail to continue loading senders. The newsletters you set up stay in place." : GMAIL_UPGRADE_MESSAGE, checked: undefined };
	}
	if (discovering && input.pollCount >= GMAIL_DISCOVERY_MAX_POLLS) {
		return { lead: "Still checking. ", checked: checkedLabel(count, " so far…") };
	}
	if (discovering) {
		return { lead: checkingForNewMessages(input) ? "Checking for new messages · " : "Checking… ", checked: checkedLabel(count, "") };
	}
	if (input.discovery.state === "idle") return { lead: "Load senders from your Gmail account to choose one.", checked: undefined };
	if (input.discovery.state === "failed") {
		return {
			lead: "I couldn't finish loading your Gmail senders. Your saved choices are still available. Try Load senders again.",
			checked: undefined,
		};
	}
	const discovered = input.discoveredSenders.length;
	return { lead: `${discovered.toLocaleString("en")} ${discovered === 1 ? "sender" : "senders"} discovered · `, checked: checkedLabel(count, "") };
}

function discoveryPollTrigger(nextPoll: number): "every 3s" | "every 15s" {
	return nextPoll <= GMAIL_DISCOVERY_FAST_POLLS ? "every 3s" : "every 15s";
}

const GMAIL_POLL_COPY: Record<GmailPollState, { watching: string; exhausted: string }> = {
	"awaiting-confirmation": {
		watching: "Watching for Gmail to confirm the forwarding address.",
		exhausted:
			"Still waiting. If you haven't added the address in Gmail yet, add it and refresh this page. If you added it more than a few minutes ago, remove it in Gmail and add it again so Google sends a new confirmation.",
	},
	"confirm-failed": {
		watching: "Watching for Gmail to send a new confirmation.",
		exhausted: "Still waiting. Once you've added the address again in Gmail, refresh this page.",
	},
};

export function toGmailPollViewModel(input: { pollCount: number; state: GmailPollState; picker?: GmailPickerState }): GmailPollViewModel {
	const canPoll = input.pollCount < GMAIL_CONFIRM_MAX_POLLS;
	const copy = GMAIL_POLL_COPY[input.state];
	return {
		pollUrl: canPoll ? buildGmailStatusUrl({ pollCount: input.pollCount + 1, state: input.state, picker: input.picker }) : undefined,
		message: canPoll ? copy.watching : copy.exhausted,
	};
}

function readlistPicker(input: {
	page: GmailPageInput;
	state: GmailPickerState;
	selected: readonly ReadlistRef[];
	pending: boolean;
}): GmailReadlistPickerViewModel {
	const { readlist: _readlist, import: _import, readlist_name: _name, delivery: _delivery, sender: _sender, added: _added, search: _search, ...fieldsState } = input.state;
	return {
		open: input.page.error !== undefined && READLIST_PICKER_ERRORS.has(input.page.error),
		choiceLabel: input.selected.map((readlist) => readlist.label).join(", "),
		options: [DEFAULT_READLIST, ...input.page.readlists.filter((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG)].map((readlist) => ({
			slug: readlist.slug,
			label: readlist.label,
			selected: input.selected.some((selected) => selected.slug === readlist.slug),
			locked: readlist.slug === DEFAULT_READLIST_SLUG,
		})),
		pagePath: GMAIL_PATH,
		canCreate: !input.page.readlistLimitReached,
		createAction: trackGmail(GMAIL_READLIST_CREATE_PATH, "create-readlist"),
		fields: gmailGetFields(fieldsState, "choose-readlists"),
		confirmLabel: input.pending ? "Confirm readlists" : "Apply readlists",
		readlistName: input.page.state.readlist_name ?? "",
		nameMaxLength: READLIST_LABEL_MAX_LENGTH,
		limitMessage: `You can keep up to ${READLIST_MAX_PER_USER} readlists. Choose an existing readlist.`,
	};
}

function saveFor(input: {
	state: GmailPickerState;
	offerImport: boolean;
	pending: boolean;
	invalid: boolean;
	autofocus: boolean;
}): GmailSaveViewModel {
	return {
		action: trackGmail(GMAIL_SENDER_ADD_PATH, "save-mapping"),
		offerImport: input.offerImport,
		importChecked: input.state.import === "1",
		disabled: input.pending || input.invalid,
		autofocus: input.autofocus,
	};
}

function dialogMode(input: { page: GmailPageInput; showSenders: boolean; ticked: readonly string[] }): GmailDialogMode {
	if (!input.showSenders) return "none";
	const [only, ...others] = input.ticked;
	const editingMapped = others.length === 0 && input.page.senders.some((sender) => sender.senderEmail === only && sender.addedToFilterAt !== undefined);
	if (input.page.state.edit === "1" && editingMapped) return "edit";
	if (input.page.state.add === "1" || input.page.notification === true || input.page.state.edit === "1") return "add";
	return "none";
}

type GmailOpeningFocus = "none" | "save" | "checklist" | "search";

function openingFocus(input: { mode: GmailDialogMode; focusOnOpen: boolean; checklist: GmailSenderChecklist }): GmailOpeningFocus {
	if (!input.focusOnOpen || input.mode === "none") return "none";
	if (input.mode === "edit") return "save";
	return input.checklist.groups.length > 0 ? "checklist" : "search";
}

function focusChecklist(groups: readonly GmailChecklistGroup[]): GmailChecklistGroup[] {
	const rows = groups.flatMap((group) => group.rows);
	const target = rows.find((row) => row.checked) ?? rows.at(0);
	return groups.map((group) => ({ ...group, rows: group.rows.map((row) => ({ ...row, autofocus: row === target })) }));
}

function dialogFor(input: {
	mode: GmailDialogMode;
	state: GmailPickerState;
	ticked: readonly ForwardableSender[];
	banners: Record<GmailBannerSurface, GmailBannerKeys>;
	saved: number | undefined;
	awaitingConfirmation: boolean;
	candidates: ReadonlyMap<ForwardableSender, GmailSenderCandidate>;
}): GmailDialogViewModel {
	const page = input.banners.page;
	const closed = buildGmailUrl({
		error: page.error,
		notice: page.notice,
		saved: page.notice === undefined ? undefined : input.saved,
		search: input.state.search,
		discovery: "started",
	});
	const edited = input.mode === "edit" ? input.ticked.at(0) : undefined;
	const editedCandidate = edited === undefined ? undefined : input.candidates.get(edited);
	return {
		mode: input.mode,
		key: edited === undefined ? "gmail-add" : "gmail-edit",
		title: edited === undefined ? "Add newsletters" : `Edit ${(editedCandidate === undefined ? undefined : gmailSenderName(editedCandidate)) ?? edited}`,
		opener: edited ?? "add",
		closeHref: trackGmail(closed, "close-dialog"),
		cancelHref: trackGmail(closed, "cancel-dialog"),
		senderFields: edited === undefined ? [] : [{ name: "sender", value: edited }, ...(input.state.search === undefined ? [] : [{ name: "search", value: input.state.search }])],
		alerts: errorBanners(input.banners.dialog.error),
		notices: noticeBanners({ key: input.banners.dialog.notice, awaitingConfirmation: input.awaitingConfirmation, saved: input.saved }),
	};
}

const DELIVERY_ORDER: readonly GmailDeliveryMode[] = ["issue", "links", "both"];

function deliveryChoice(input: { state: GmailPickerState; sender: GmailMapping | undefined }): GmailDeliveryChoiceViewModel {
	const chosen = input.state.delivery ?? pickerDeliveryMode(input.sender);
	return {
		options: DELIVERY_ORDER.map((value) => ({
			value,
			label: GMAIL_DELIVERY_COPY[value].option,
			description: GMAIL_DELIVERY_COPY[value].description,
			checked: value === chosen,
		})),
	};
}

function readlistChoice(input: GmailPageInput, sender: GmailMapping | undefined): readonly ReadlistRef[] {
	if (input.state.readlist !== undefined) {
		const selected = new Set(gmailSelectedReadlists(input.state));
		return [DEFAULT_READLIST, ...input.readlists.filter((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG && selected.has(readlist.slug))];
	}
	if (sender?.mappedAddresses !== undefined) {
		const destination = gmailMappingDestination({ ...input, sender });
		if (destination.kind === "readlist") return destination.readlists;
	}
	return [DEFAULT_READLIST];
}

function refreshActions(input: { listed: number | undefined; knownCount: number }): { label: string }[] {
	if (input.listed === undefined || input.knownCount <= input.listed) return [];
	const found = input.knownCount - input.listed;
	return [{ label: `Show ${found.toLocaleString("en")} newly found ${found === 1 ? "newsletter" : "newsletters"}` }];
}

const TICK_FIELDS: ReadonlySet<string> = new Set(["sender", "added"]);

export function toGmailPageViewModel(input: GmailPageInput): GmailPageViewModel {
	const state = gmailConnectionState(input.connection);
	const pollState = gmailPollState(state);
	const revoked = state === "revoked";
	const candidates = gmailSenderCandidates(input);
	const checklist = toGmailSenderChecklist({
		state: input.state,
		candidates,
		catalogAvailable: input.detection.status === "available",
		command: input.command,
	});
	const ticked = checklist.sender;
	const entryFor = (email: string) => input.senders.find((sender) => sender.senderEmail === email);
	const tickedEntries = input.senders.filter((sender) => ticked.includes(sender.senderEmail));
	const tickedMapped = tickedEntries.filter((sender) => sender.addedToFilterAt !== undefined);
	const anchor = tickedEntries.length === 1 ? tickedEntries[0] : undefined;
	const selectedReadlists = readlistChoice(input, anchor);
	const notified = input.notification ? ticked.at(0) : undefined;
	const choiceFor = input.state.readlist_choice_for ?? (notified !== undefined && entryFor(notified)?.mappedAddresses === undefined ? notified : undefined);
	const pending = choiceFor !== undefined && ticked.some((email) => email === choiceFor) && entryFor(choiceFor)?.mappedAddresses === undefined && input.readlists.some((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG);
	const invalid = gmailSelectedReadlists(input.state).some((slug) => !input.readlists.some((readlist) => readlist.slug === slug));
	const showSenders = !revoked && input.metadataScopeGranted && !input.discovery.requiresReconnect;
	const mode = dialogMode({ page: input, showSenders, ticked });
	const focus = openingFocus({ mode, focusOnOpen: input.focusOnOpen, checklist });
	const banners = bannerKeys({ error: input.error, notice: input.notice, mode });
	const pickerState: GmailPickerState = {
		...input.state,
		add: mode === "add" ? "1" : undefined,
		edit: mode === "edit" ? "1" : undefined,
		sender: ticked,
		added: checklist.added,
		readlist: ticked.length === 0 ? input.state.readlist : selectedReadlists.map((readlist) => readlist.slug),
		readlist_choice_for: choiceFor,
		readlist_name: undefined,
	};
	const results = toGmailSenderResults({ state: pickerState, candidates });
	const discovering = input.discoveryPending || input.discovery.state === "running" || (input.discoveryStarted && input.discovery.state === "idle");
	const polling = discovering && input.pollCount < GMAIL_DISCOVERY_MAX_POLLS;
	const { sender: _sender, added: _added, ...pollPicker } = pickerState;
	const { search: _search, discovery_after: _after, ...discoveryState } = pollPicker;
	const poll = new URL(buildGmailUrl({ ...pollPicker, discovery: "started" }), "https://readplace.com");
	poll.pathname = GMAIL_SENDERS_PATH;
	poll.searchParams.set("poll", String(input.pollCount + 1));
	const status = discoveryStatus(input, discovering);
	const showStep = pollState !== undefined && input.gatewayLive;
	const commitVariant = showStep ? "neutral" : "primary";
	const offerImport = ticked.length === 0 || ticked.some((email) => !tickedMapped.some((sender) => sender.senderEmail === email));
	const save = saveFor({ state: pickerState, offerImport, pending, invalid, autofocus: focus === "save" });
	const searchFields = gmailGetFields(pickerState, "search-senders");
	return {
		state, stateModifier: `gmail__status--${state}`, statusLabel: STATUS_LABELS[state], accountEmail: input.connection.accountEmail, pollState,
		integrationsPath: trackGmail(INTEGRATIONS_PATH, "back-to-newsletters"),
		gatewayAddress: input.connection.gatewayAddress, mailboxUrl: buildGmailMailboxUrl(input.connection.accountEmail),
		pickerState, pagePath: GMAIL_PATH, pageUrl: buildGmailUrl({ ...pickerState, discovery: "started" }), searchPath: GMAIL_SENDERS_PATH,
		discoveryAction: trackGmail(GMAIL_DISCOVERY_START_PATH, "load-senders"),
		discoveryFields: gmailBodyFields(discoveryState),
		disconnectAction: trackGmail(GMAIL_DISCONNECT_PATH, "disconnect"),
		reconnect: gmailConnectionPrompt({
			canConnectGmail: input.canConnectGmail,
			message: "Google ended the connection. Reconnect to keep forwarding newsletters.",
			content: "reconnect", label: "Reconnect Gmail", variant: "primary", fields: [],
		}),
		metadataReconnect: gmailConnectionPrompt({
			canConnectGmail: input.canConnectGmail,
			message: "Reconnect Gmail to choose senders from your mailbox. The newsletters you set up stay in place.",
			content: "grant-sender-access", label: "Reconnect Gmail", variant: commitVariant, fields: [],
		}),
		labelPermission: revoked || input.modifyScopeGranted ? undefined : gmailConnectionPrompt({
			canConnectGmail: input.canConnectGmail,
			message: "Let Readplace tidy Gmail: once a newsletter is saved, it adds the label imported-to-readplace to the original email and marks it read. Your other labels and your inbox stay as they are.",
			content: "grant-label-permission", label: "Allow labelling", variant: "neutral", fields: [{ name: "intent", value: "label" }],
		}),
		showStep,
		showSenders,
		showReconnect: revoked,
		showMetadataReconnect: !revoked && (!input.metadataScopeGranted || input.discovery.requiresReconnect === true),
		autoDiscoverAction: input.discoveryStarted ? undefined : GMAIL_DISCOVERY_START_PATH,
		dialog: dialogFor({ mode, state: pickerState, ticked, banners, saved: input.saved, awaitingConfirmation: pollState !== undefined, candidates }),
		senderPicker: { open: focus === "search", searchAutofocus: focus === "search" },
		search: pickerState.search ?? "",
		searchFields: searchFields.filter((field) => field.name !== "search" && field.name !== "discovery_after" && !TICK_FIELDS.has(field.name)),
		notificationSender: notified,
		status: {
			discoveryState: input.discovery.state,
			discoveryAfter: pickerState.discovery_after,
			statusLead: status.lead,
			checkedLabel: status.checked,
			loadButtonLabel: polling ? (checkingForNewMessages(input) ? "Checking for new messages…" : "Checking…") : "Load senders",
			reconnectActions: input.discovery.requiresReconnect ? gmailConnectionPrompt({
				canConnectGmail: input.canConnectGmail,
				message: status.lead,
				content: "reconnect-sender-access", label: "Reconnect Gmail", variant: "neutral", fields: [],
			}).actions : [],
			refreshActions: refreshActions({ listed: input.listed, knownCount: checklist.knownCount }),
			pollUrl: polling ? `${poll.pathname}${poll.search}` : undefined,
			pollTrigger: polling ? discoveryPollTrigger(input.pollCount + 1) : undefined,
		},
		checklist: focus === "checklist" ? { ...checklist, groups: focusChecklist(checklist.groups) } : checklist,
		results: {
			resultsState: results.resultsState,
			resultsMessage: results.resultsMessage,
			refineSearch: results.resultsState === "limited",
			options: results.options,
		},
		readlistPicker: readlistPicker({ page: input, state: pickerState, selected: selectedReadlists, pending }),
		delivery: deliveryChoice({ state: pickerState, sender: anchor }),
		save,
		mappings: toGmailMappingsViewModel({
			userId: input.userId,
			canConnectGmail: input.canConnectGmail,
			connection: input.connection,
			senders: input.senders,
			destinations: input.destinations,
			readlists: input.readlists,
			candidates,
			imports: input.imports,
			readScopeGranted: input.readScopeGranted,
			readlistChoiceShown: showSenders,
			state: pickerState,
			importsPollCount: input.importsPollCount,
			discoveryStarted: input.discoveryStarted,
			addVariant: commitVariant,
		}),
		alerts: [
			...(input.gatewayLive ? [] : [{ key: "gateway_disabled", message: GMAIL_GATEWAY_DISABLED_MESSAGE }]),
			...errorBanners(banners.page.error),
			...(input.connection.lastConfirmError === undefined ? [] : [{ key: "confirm_failed", message: GMAIL_CONFIRM_FAILED_MESSAGES[input.connection.lastConfirmError.reason] }]),
		],
		notices: noticeBanners({ key: banners.page.notice, awaitingConfirmation: pollState !== undefined, saved: input.saved }),
	};
}
