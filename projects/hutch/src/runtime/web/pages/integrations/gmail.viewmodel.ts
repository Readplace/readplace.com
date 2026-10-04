import type { AlertVariant } from "@packages/web-shell";
import type {
	DiscoveredGmailSender,
	GmailConfirmFailureReason,
	GmailConnection,
	GmailConnectionState,
	GmailDiscovery,
	GmailHistoryImportJob,
	GmailSenderEntry,
} from "@packages/domain/gmail";
import { gmailConnectionState } from "@packages/domain/gmail";
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
import { GMAIL_CONNECT_PATH, INTEGRATIONS_PATH } from "./gmail-connect.url";
import { type FormField, gmailGetFields, trackGmail } from "./gmail-form-fields";
import { gmailMappingDestination, type GmailMappingsViewModel, toGmailMappingsViewModel } from "./gmail-mappings.viewmodel";
import {
	type GmailResultsAction,
	type GmailSenderOption,
	type GmailSenderResultsState,
	gmailSenderCandidates,
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
	connection: GmailConnection;
	senders: readonly GmailSenderEntry[];
	destinations: ReadonlyMap<string, InboxAddressEntry>;
	readlists: readonly ReadlistRef[];
	readlistLimitReached: boolean;
	gatewayLive: boolean;
	metadataScopeGranted: boolean;
	readonlyScopeGranted: boolean;
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
	discoveryStarted: boolean;
	discoveryPending: boolean;
	pollCount: number;
	importsPollCount: number;
	error: string | undefined;
	notice: string | undefined;
	notification?: boolean;
}

interface GmailChooserViewModel {
	discoveryState: string;
	discoveryAfter: string | undefined;
	statusLead: string;
	checkedLabel: string | undefined;
	loadButtonLabel: string;
	resultsState: GmailSenderResultsState;
	resultsMessage: string;
	refineSearch: boolean;
	options: GmailSenderOption[];
	hasOptions: boolean;
	actions: GmailResultsAction[];
	reconnectAction: string | undefined;
	reconnectVariant: "primary" | "neutral";
	pollUrl: string | undefined;
	pollTrigger: string | undefined;
	pagePath: string;
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
	confirmSender: string;
	readlistName: string;
	nameMaxLength: number;
	limitMessage: string;
}

interface GmailSaveViewModel {
	action: string;
	offerImport: boolean;
	importChecked: boolean;
	variant: "primary" | "neutral";
	disabled: boolean;
}

export interface GmailPageViewModel {
	state: GmailConnectionState;
	stateModifier: string;
	statusLabel: string;
	pollState: GmailPollState | undefined;
	integrationsPath: string;
	gatewayAddress: string;
	mailboxUrl: string;
	pagePath: string;
	pageUrl: string;
	pickerState: GmailPickerState;
	searchPath: string;
	discoveryAction: string;
	disconnectAction: string;
	reconnectAction: string;
	metadataReconnectAction: string;
	showStep: boolean;
	showSenders: boolean;
	showReconnect: boolean;
	showMetadataReconnect: boolean;
	commitVariant: "primary" | "neutral";
	autoDiscoverAction: string | undefined;
	search: string;
	searchFields: FormField[];
	selectedSender: string | undefined;
	notificationSender: string | undefined;
	senderChoiceName: string | undefined;
	senderChoiceLabel: string;
	chooser: GmailChooserViewModel;
	readlistPicker: GmailReadlistPickerViewModel;
	save: GmailSaveViewModel | undefined;
	mappings: GmailMappingsViewModel;
	alerts: GmailBannerViewModel[];
	notices: GmailNoticeViewModel[];
}

export interface GmailPollViewModel { pollUrl: string | undefined; message: string }

const STATUS_LABELS: Record<GmailConnectionState, string> = {
	disconnected: "Not connected", disconnecting: "Disconnecting…", revoked: "Reconnect needed",
	"filter-failed": "Needs attention", "confirm-failed": "Needs attention",
	"awaiting-confirmation": "Step 2 of 2",
	"ready-to-filter": "Connected", filtering: "Forwarding",
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
	sender_invalid: "Choose a newsletter from your Gmail account.",
	sender_unknown: "I couldn't find that sender. Load your Gmail senders and try again.",
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
	sender_removed: { message: "Mapping removed. Articles you already saved stay in your readlists.", variant: "success" },
	sender_mapped: {
		message: "Mapping saved. Gmail will forward new mail from this sender.",
		awaitingConfirmation: "Mapping saved. New mail from this sender will be forwarded once Gmail confirms the forwarding address.",
		variant: "success",
	},
	sender_remapped: {
		message: "Mapping updated. New mail from this sender goes to All and your selected readlists.",
		awaitingConfirmation: "Mapping updated. New mail from this sender will be forwarded once Gmail confirms the forwarding address.",
		variant: "success",
	},
	readlist_created: { message: "Readlist created. Save the mapping to use it.", variant: "success" },
	readlist_reused: { message: "You already have a readlist with that name, so I chose it.", variant: "info" },
	import_started: { message: "Importing unread messages from the last 30 days.", variant: "success" },
	import_permission_needed: { message: "To import unread messages, give Readplace permission to read them in Gmail.", variant: "info" },
	import_permission_refused: { message: "Google didn't grant permission to read your messages, so the import is waiting. New mail still forwards.", variant: "warning" },
	import_permission_granted: { message: "Readplace can now read your Gmail messages. Start the import from the newsletter below.", variant: "success" },
	import_cancelled: { message: "Import cancelled. Messages already imported stay in your readlists.", variant: "success" },
	filter_retry_requested: { message: "Updating Gmail. Refresh in a moment.", variant: "info" },
};

const READLIST_PICKER_ERRORS: ReadonlySet<string> = new Set(["readlist_invalid", "readlist_name_invalid", "readlist_limit"]);

function errorBanners(key: string | undefined): GmailBannerViewModel[] {
	return Object.entries(GMAIL_PAGE_ERRORS)
		.filter(([errorKey]) => errorKey === key)
		.map(([errorKey, message]) => ({ key: errorKey, message }));
}

function noticeBanners(key: string | undefined, awaitingConfirmation: boolean): GmailNoticeViewModel[] {
	return Object.entries(GMAIL_PAGE_NOTICES)
		.filter(([noticeKey]) => noticeKey === key)
		.map(([noticeKey, notice]) => ({
			key: noticeKey,
			message: awaitingConfirmation ? notice.awaitingConfirmation ?? notice.message : notice.message,
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
		return { lead: "Reconnect Gmail to continue loading senders. Your existing mappings stay in place.", checked: undefined };
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
	const { readlist: _readlist, import: _import, readlist_name: _name, ...fieldsState } = input.state;
	return {
		open: input.state.edit === "1" || (input.page.error !== undefined && READLIST_PICKER_ERRORS.has(input.page.error)),
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
		confirmSender: input.state.sender ?? "",
		readlistName: input.page.state.readlist_name ?? "",
		nameMaxLength: READLIST_LABEL_MAX_LENGTH,
		limitMessage: `You can keep up to ${READLIST_MAX_PER_USER} readlists. Choose an existing readlist.`,
	};
}

function saveFor(input: {
	state: GmailPickerState;
	sender: GmailSenderEntry | undefined;
	variant: "primary" | "neutral";
	pending: boolean;
	invalid: boolean;
}): GmailSaveViewModel {
	const offerImport = input.sender?.addedToFilterAt === undefined;
	return {
		action: trackGmail(GMAIL_SENDER_ADD_PATH, "save-mapping"),
		offerImport,
		importChecked: input.state.import === "1",
		variant: input.variant,
		disabled: input.pending || input.invalid,
	};
}

function readlistChoice(input: GmailPageInput, sender: GmailSenderEntry | undefined): readonly ReadlistRef[] {
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

export function toGmailPageViewModel(input: GmailPageInput): GmailPageViewModel {
	const state = gmailConnectionState(input.connection);
	const pollState = gmailPollState(state);
	const revoked = state === "revoked";
	const candidates = gmailSenderCandidates(input);
	const selectedCandidate = [...candidates.values()].find((candidate) => candidate.email === input.state.sender);
	const selectedSenderEntry = input.senders.find((sender) => sender.senderEmail === selectedCandidate?.email);
	const selectedReadlists = readlistChoice(input, selectedSenderEntry);
	const choiceFor = input.state.readlist_choice_for ?? (input.notification && selectedSenderEntry?.mappedAddresses === undefined ? selectedCandidate?.email : undefined);
	const pending = choiceFor === selectedCandidate?.email && choiceFor !== undefined && selectedSenderEntry?.mappedAddresses === undefined && input.readlists.some((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG);
	const invalid = gmailSelectedReadlists(input.state).some((slug) => !input.readlists.some((readlist) => readlist.slug === slug));
	const pickerState: GmailPickerState = {
		...input.state,
		sender: selectedCandidate?.email,
		readlist: selectedCandidate === undefined ? input.state.readlist : selectedReadlists.map((readlist) => readlist.slug),
		readlist_choice_for: choiceFor,
		readlist_name: undefined,
	};
	const results = toGmailSenderResults({
		state: pickerState,
		candidates,
		catalogAvailable: input.detection.status === "available",
	});
	const discovering = input.discoveryPending || input.discovery.state === "running" || (input.discoveryStarted && input.discovery.state === "idle");
	const polling = discovering && input.pollCount < GMAIL_DISCOVERY_MAX_POLLS;
	const poll = new URL(buildGmailUrl({ ...pickerState, discovery: "started" }), "https://readplace.com");
	poll.pathname = GMAIL_SENDERS_PATH;
	poll.searchParams.set("poll", String(input.pollCount + 1));
	const status = discoveryStatus(input, discovering);
	const showStep = pollState !== undefined && input.gatewayLive;
	const commitVariant = showStep ? "neutral" : "primary";
	const save = selectedCandidate !== undefined
		? saveFor({ state: pickerState, sender: selectedSenderEntry, variant: commitVariant, pending, invalid })
		: undefined;
	const showSenders = !revoked && input.metadataScopeGranted && !input.discovery.requiresReconnect;
	return {
		state, stateModifier: `gmail__status--${state}`, statusLabel: STATUS_LABELS[state], pollState,
		integrationsPath: trackGmail(INTEGRATIONS_PATH, "back-to-newsletters"),
		gatewayAddress: input.connection.gatewayAddress, mailboxUrl: buildGmailMailboxUrl(input.connection.accountEmail),
		pickerState, pagePath: GMAIL_PATH, pageUrl: buildGmailUrl({ ...pickerState, discovery: "started" }), searchPath: GMAIL_SENDERS_PATH,
		discoveryAction: trackGmail(GMAIL_DISCOVERY_START_PATH, "load-senders"),
		disconnectAction: trackGmail(GMAIL_DISCONNECT_PATH, "disconnect"),
		reconnectAction: trackGmail(GMAIL_CONNECT_PATH, "reconnect"),
		metadataReconnectAction: trackGmail(GMAIL_CONNECT_PATH, "grant-sender-access"),
		showStep,
		showSenders,
		showReconnect: revoked,
		showMetadataReconnect: !revoked && (!input.metadataScopeGranted || input.discovery.requiresReconnect === true),
		commitVariant,
		autoDiscoverAction: input.discoveryStarted ? undefined : GMAIL_DISCOVERY_START_PATH,
		search: pickerState.search ?? "",
		searchFields: gmailGetFields(pickerState, "search-senders").filter((field) => field.name !== "search" && field.name !== "discovery_after"),
		selectedSender: selectedCandidate?.email,
		notificationSender: input.notification ? selectedCandidate?.email : undefined,
		senderChoiceName: selectedCandidate?.newsletterName,
		senderChoiceLabel: selectedCandidate?.email ?? "Choose a newsletter",
		chooser: {
			discoveryState: input.discovery.state,
			discoveryAfter: pickerState.discovery_after,
			statusLead: status.lead,
			checkedLabel: status.checked,
			loadButtonLabel: polling ? (checkingForNewMessages(input) ? "Checking for new messages…" : "Checking…") : "Load senders",
			resultsState: results.resultsState,
			resultsMessage: results.resultsMessage,
			refineSearch: results.resultsState === "limited",
			options: results.options,
			hasOptions: results.options.length > 0,
			actions: results.actions,
			reconnectAction: input.discovery.requiresReconnect ? trackGmail(GMAIL_CONNECT_PATH, "reconnect-sender-access") : undefined,
			reconnectVariant: showStep || save !== undefined ? "neutral" : "primary",
			pollUrl: polling ? `${poll.pathname}${poll.search}` : undefined,
			pollTrigger: polling ? discoveryPollTrigger(input.pollCount + 1) : undefined,
			pagePath: GMAIL_PATH,
		},
		readlistPicker: readlistPicker({ page: input, state: pickerState, selected: selectedReadlists, pending }),
		save,
		mappings: toGmailMappingsViewModel({
			userId: input.userId,
			connection: input.connection,
			senders: input.senders,
			destinations: input.destinations,
			readlists: input.readlists,
			candidates,
			imports: input.imports,
			readonlyScopeGranted: input.readonlyScopeGranted,
			readlistChoiceShown: showSenders,
			state: pickerState,
			importsPollCount: input.importsPollCount,
		}),
		alerts: [
			...(input.gatewayLive ? [] : [{ key: "gateway_disabled", message: GMAIL_GATEWAY_DISABLED_MESSAGE }]),
			...errorBanners(input.error),
			...(input.connection.lastConfirmError === undefined ? [] : [{ key: "confirm_failed", message: GMAIL_CONFIRM_FAILED_MESSAGES[input.connection.lastConfirmError.reason] }]),
		],
		notices: noticeBanners(input.notice, pollState !== undefined),
	};
}
