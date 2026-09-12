import { withInternalTracking } from "@packages/web-shell";
import type { GmailConnection, GmailConnectionState, GmailDiscovery, GmailSenderEntry } from "@packages/domain/gmail";
import { gmailConnectionState } from "@packages/domain/gmail";
import type { InboxAddressEntry } from "@packages/domain/inbox";
import { addressCapReached, INBOX_ADDRESS_MAX_PER_USER, isCappedAddress, isLiveAddress } from "@packages/domain/inbox";
import {
	buildGmailStatusUrl, buildGmailUrl, GMAIL_CONFIRM_MAX_POLLS,
	GMAIL_DISCONNECT_PATH, GMAIL_SENDER_ADD_PATH, GMAIL_SENDER_REMOVE_PATH,
	GMAIL_DISCOVERY_START_PATH, GMAIL_SENDERS_PATH, GMAIL_PATH,
	buildGmailMailboxUrl, type GmailPageError, type GmailPageNotice,
} from "./gmail.url";
import { GMAIL_CONNECT_PATH, INTEGRATIONS_PATH } from "./gmail-connect.url";

interface FormField { name: string; value: string }
interface GmailSenderOption { email: string; name: string | undefined; fields: FormField[] }
interface GmailDestinationOption {
	value: string;
	label: string;
	address: string | undefined;
	fields: FormField[];
}
interface GmailMappingGroup {
	destination: string;
	name: string | undefined;
	disabled: boolean;
	senders: { email: string }[];
}
export interface GmailBannerViewModel { key: string; message: string }

export interface GmailPageInput {
	connection: GmailConnection;
	senders: readonly GmailSenderEntry[];
	inboxes: readonly InboxAddressEntry[];
	gatewayLive: boolean;
	metadataScopeGranted: boolean;
	discoveredSenders: readonly { email: string; name?: string }[];
	discovery: {
		state: "idle" | GmailDiscovery["state"];
		mode: GmailDiscovery["mode"];
		scannedCount: number;
		estimatedTotalMessages: number | undefined;
		requiresReconnect?: boolean;
	};
	search: string;
	selectedSender?: string;
	selectedDestination?: string;
	discoveryStarted: boolean;
	discoveryAfter?: string;
	discoveryPending: boolean;
	inboxName?: string;
	pollCount?: number;
	error?: string;
	notice?: string;
}

export interface GmailPageViewModel {
	state: GmailConnectionState;
	stateModifier: string;
	statusLabel: string;
	integrationsPath: string;
	gatewayAddress: string;
	mailboxUrl: string;
	pagePath: string;
	searchPath: string;
	saveAction: string;
	removeSenderAction: string;
	discoveryAction: string;
	disconnectAction: string;
	reconnectAction: string;
	manageInboxesUrl: string;
	showStep: boolean;
	showSenders: boolean;
	showReconnect: boolean;
	showMetadataReconnect: boolean;
	autoDiscover: boolean;
	search: string;
	searchFields: FormField[];
	selectedSender: string | undefined;
	selectedDestination: string | undefined;
	destinationLabel: string;
	destinationOptions: GmailDestinationOption[];
	inboxPickerOpen: boolean;
	inboxName: string;
	inboxLimit: boolean;
	inboxMax: number;
	canCreateInbox: boolean;
	canSave: boolean;
	chooser: {
		state: string;
		discoveryAfter: string | undefined;
		message: string;
		loadButtonLabel: string;
		options: GmailSenderOption[];
		hasOptions: boolean;
		refineMessage: string | undefined;
		reconnectAction: string | undefined;
		pollUrl: string | undefined;
		pagePath: string;
	};
	mappings: GmailMappingGroup[];
	hasMappings: boolean;
	alerts: GmailBannerViewModel[];
	notices: GmailBannerViewModel[];
}

export interface GmailPollViewModel { pollUrl: string | undefined; message: string }
const GMAIL_SOURCE = "integrations-gmail";

function track(href: string, content: string): string {
	return withInternalTracking(href, { source: GMAIL_SOURCE, content });
}

function fieldsFor(params: { search: string; sender?: string; destination?: string; discovery_after?: string }, content: string): FormField[] {
	const url = new URL(track(buildGmailUrl({ ...params, discovery: "started" }), content), "https://readplace.com");
	return Array.from(url.searchParams, ([name, value]) => ({ name, value }));
}

const STATUS_LABELS: Record<GmailConnectionState, string> = {
	disconnected: "Not connected", disconnecting: "Disconnecting…", revoked: "Reconnect needed",
	"filter-failed": "Needs attention", "awaiting-confirmation": "Step 2 of 2",
	"ready-to-filter": "Connected", filtering: "Forwarding",
};

export const GMAIL_PAGE_ERRORS: Record<GmailPageError, string> = {
	sender_invalid: "Choose a sender from your Gmail account.",
	sender_duplicate: "This sender already has a mapping.",
	sender_unknown: "I couldn't find that sender. Load your Gmail senders and try again.",
	metadata_required: "Reconnect Gmail to choose senders from your mailbox.",
	destination_invalid: "Choose one of your enabled inboxes, or create a new inbox.",
	inbox_name_invalid: "Give the inbox a name using letters, numbers and hyphens.",
	inbox_name_taken: "You already have an inbox with that name. Choose it from the list.",
	inbox_limit: `You have ${INBOX_ADDRESS_MAX_PER_USER} active inboxes. Choose an existing inbox or disable one in Manage Your Inboxes below.`,
};

export const GMAIL_GATEWAY_DISABLED_MESSAGE =
	"This forwarding address has been switched off, so Gmail can't deliver to it. Disconnect Gmail below, then connect again to get a working one.";

export const GMAIL_PAGE_NOTICES: Record<GmailPageNotice, string> = {
	connected: "Gmail is connected.", confirmed: "Forwarding confirmed.",
	sender_added: "Mapping saved. New mail from this sender will go to the selected inbox.",
	sender_removed: "Sender removed from the mapping.",
	sender_mapped: "Mapping saved.", inbox_created: "Inbox created and mapping saved.",
	inbox_confirmation_required: "Mapping saved.",
};

function bannersFor(key: string | undefined, messages: Record<string, string>): GmailBannerViewModel[] {
	if (key === undefined) return [];
	const message = messages[key];
	return message === undefined ? [] : [{ key, message }];
}

function discoveryMessage(input: GmailPageInput, availableSenders: number): string {
	if (input.discovery.requiresReconnect) return "Reconnect Gmail to continue loading senders. Your existing mappings stay in place.";
	switch (input.discovery.state) {
		case "idle": return "Load senders from your Gmail account to choose one.";
		case "running": return availableSenders > 0 ? "You can select a sender now." : "Gmail is checking for senders.";
		case "failed": return "I couldn't finish loading your Gmail senders. Your saved choices are still available. Try Load senders again.";
		case "complete": return `${availableSenders} Gmail senders available.`;
	}
}

function loadButtonLabel(input: GmailPageInput, polling: boolean): string {
	if (!polling) return "Load senders";
	if (input.discoveryPending && input.discovery.state === "complete") return "Checking Gmail for new messages…";
	if (input.discovery.mode === "history") return "Checking Gmail for new messages…";
	if (input.discovery.estimatedTotalMessages !== undefined) {
		return `Checking ${input.discovery.scannedCount} of ${input.discovery.estimatedTotalMessages} messages…`;
	}
	return "Checking Gmail messages…";
}

function mappingGroups(input: GmailPageInput): GmailMappingGroup[] {
	const groups = new Map<string, GmailMappingGroup>();
	for (const sender of input.senders) {
		if (sender.addedToFilterAt === undefined) continue;
		const destination = sender.mappedAddress ?? "legacy";
		let group = groups.get(destination);
		if (group === undefined) {
			const inbox = input.inboxes.find((entry) => entry.address === destination);
			group = {
				destination,
				name: destination === "legacy" ? undefined : inbox?.name ?? destination,
				disabled: inbox !== undefined && !isLiveAddress(inbox),
				senders: [],
			};
			groups.set(destination, group);
		}
		group.senders.push({ email: sender.senderEmail });
	}
	return [...groups.values()];
}

export function toGmailPollViewModel(input: { pollCount: number }): GmailPollViewModel {
	const canPoll = input.pollCount < GMAIL_CONFIRM_MAX_POLLS;
	return {
		pollUrl: canPoll ? buildGmailStatusUrl(input.pollCount + 1) : undefined,
		message: canPoll ? "Watching for Gmail to confirm the forwarding address."
			: "Still waiting. Once you've added the address in Gmail, refresh this page.",
	};
}

export function toGmailPageViewModel(input: GmailPageInput): GmailPageViewModel {
	const state = gmailConnectionState(input.connection);
	const revoked = state === "revoked";
	const inboxLimit = addressCapReached({ purpose: "gmail-mapped", owned: input.inboxes });
	const destinations = input.inboxes.filter((entry) => isCappedAddress(entry) && isLiveAddress(entry));
	const selectedInbox = destinations.find((entry) => entry.address === input.selectedDestination);
	const selectedDestination = input.selectedDestination === "new" ? "new" : selectedInbox?.address;
	const inboxPickerErrors = new Set(["inbox_name_invalid", "inbox_name_taken", "inbox_limit"]);
	const inboxPickerOpen = input.error !== undefined && inboxPickerErrors.has(input.error) && selectedDestination === "new";
	const params = { search: input.search, sender: input.selectedSender, destination: selectedDestination, discovery_after: input.discoveryAfter };
	const needle = input.search.trim().toLowerCase();
	const availableSenders = new Map(input.discoveredSenders.map((sender) => [sender.email, sender]));
	for (const sender of input.senders) {
		if (sender.addedToFilterAt !== undefined && !availableSenders.has(sender.senderEmail)) {
			availableSenders.set(sender.senderEmail, { email: sender.senderEmail });
		}
	}
	const matches = [...availableSenders.values()]
		.filter((sender) => `${sender.email} ${sender.name ?? ""}`.toLowerCase().includes(needle))
		.sort((left, right) => left.email.localeCompare(right.email));
	const options = matches.slice(0, 100)
		.map((sender) => ({ email: sender.email, name: sender.name, fields: fieldsFor({ ...params, sender: sender.email }, "choose-sender") }));
	const pollCount = input.pollCount ?? 0;
	const discovering = input.discoveryPending || input.discovery.state === "running" || (input.discoveryStarted && input.discovery.state === "idle");
	const polling = discovering && pollCount < GMAIL_CONFIRM_MAX_POLLS;
	const poll = new URL(GMAIL_SENDERS_PATH, "https://readplace.com");
	for (const field of fieldsFor(params, "load-senders")) poll.searchParams.set(field.name, field.value);
	poll.searchParams.set("poll", String(pollCount + 1));
	const mappings = mappingGroups(input);
	return {
		state, stateModifier: `gmail__status--${state}`, statusLabel: STATUS_LABELS[state],
		integrationsPath: track(INTEGRATIONS_PATH, "back-to-integrations"),
		gatewayAddress: input.connection.gatewayAddress, mailboxUrl: buildGmailMailboxUrl(input.connection.accountEmail),
		pagePath: GMAIL_PATH, searchPath: GMAIL_SENDERS_PATH,
		saveAction: track(GMAIL_SENDER_ADD_PATH, "save-mapping"),
		removeSenderAction: track(GMAIL_SENDER_REMOVE_PATH, "exclude-sender"),
		discoveryAction: track(GMAIL_DISCOVERY_START_PATH, "load-senders"),
		disconnectAction: track(GMAIL_DISCONNECT_PATH, "disconnect"), reconnectAction: track(GMAIL_CONNECT_PATH, "reconnect"),
		manageInboxesUrl: track("/inbox/addresses", "manage-inboxes"),
		showStep: state === "awaiting-confirmation" && input.gatewayLive,
		showSenders: !revoked && input.metadataScopeGranted && !input.discovery.requiresReconnect,
		showReconnect: revoked, showMetadataReconnect: !revoked && (!input.metadataScopeGranted || input.discovery.requiresReconnect === true),
		autoDiscover: !input.discoveryStarted,
		search: input.search,
		searchFields: fieldsFor(params, "search-senders").filter((field) => field.name !== "search" && field.name !== "discovery_after"),
		selectedSender: input.selectedSender, selectedDestination,
		destinationLabel: selectedInbox?.name ?? "Choose an inbox",
		destinationOptions: destinations.map((entry) => ({ value: entry.address, label: entry.name, address: entry.address,
			fields: fieldsFor({ ...params, destination: entry.address }, "choose-inbox") })),
		inboxPickerOpen, inboxName: input.inboxName ?? "", inboxLimit, inboxMax: INBOX_ADDRESS_MAX_PER_USER,
		canCreateInbox: !inboxLimit,
		canSave: input.selectedSender !== undefined && selectedInbox !== undefined,
		chooser: {
			state: input.discovery.state,
			discoveryAfter: input.discoveryAfter,
			message: discovering && pollCount >= GMAIL_CONFIRM_MAX_POLLS ? "Still finding senders. Press Load senders to continue." : discoveryMessage(input, availableSenders.size),
			loadButtonLabel: loadButtonLabel(input, polling),
			options, hasOptions: options.length > 0,
			refineMessage: matches.length > 100 ? `Showing 100 of ${matches.length} matching senders. Refine your search to find another sender.` : undefined,
			reconnectAction: input.discovery.requiresReconnect ? track(GMAIL_CONNECT_PATH, "reconnect-sender-access") : undefined,
			pollUrl: polling ? `${poll.pathname}${poll.search}` : undefined, pagePath: GMAIL_PATH,
		},
		mappings, hasMappings: mappings.length > 0,
		alerts: [
			...(input.gatewayLive ? [] : [{ key: "gateway_disabled", message: GMAIL_GATEWAY_DISABLED_MESSAGE }]),
			...bannersFor(input.error, GMAIL_PAGE_ERRORS),
			...(input.connection.lastFilterError === undefined ? [] : [{ key: "filter", message: input.connection.lastFilterError.message }]),
		],
		notices: bannersFor(input.notice, GMAIL_PAGE_NOTICES),
	};
}
