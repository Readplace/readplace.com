import { withInternalTracking } from "@packages/web-shell";
import type {
	GmailConnection,
	GmailConnectionState,
	GmailSenderEntry,
} from "@packages/domain/gmail";
import { gmailConnectionState } from "@packages/domain/gmail";
import type { InboxAddressEntry } from "@packages/domain/inbox";
import { isLiveAddress } from "@packages/domain/inbox";
import {
	buildGmailStatusUrl,
	GMAIL_CONFIRM_MAX_POLLS,
	GMAIL_DISCONNECT_PATH,
	GMAIL_SENDER_ADD_PATH,
	GMAIL_SENDER_MAP_PATH,
	GMAIL_SENDER_REMOVE_PATH,
	buildGmailMailboxUrl,
	type GmailPageError,
	type GmailPageNotice,
} from "./gmail.url";
import { GMAIL_CONNECT_PATH, INTEGRATIONS_PATH } from "./gmail-connect.url";

export interface GmailSenderRowViewModel {
	email: string;
	detail: string;
	mappedAddress: string | undefined;
	removeAction: string;
}

export interface GmailUnsortedRowViewModel {
	email: string;
	detail: string;
	mapAction: string;
}

export interface GmailBannerViewModel {
	key: string;
	message: string;
}

export interface GmailDestinationOptionViewModel {
	value: string;
	label: string;
}

export interface GmailPageViewModel {
	state: GmailConnectionState;
	stateModifier: string;
	statusLabel: string;
	integrationsPath: string;
	gatewayAddress: string;
	mailboxUrl: string;
	addSenderAction: string;
	disconnectAction: string;
	reconnectAction: string;
	showStep: boolean;
	showSenders: boolean;
	showReconnect: boolean;
	senders: GmailSenderRowViewModel[];
	unsorted: GmailUnsortedRowViewModel[];
	destinationOptions: GmailDestinationOptionViewModel[];
	hasSenders: boolean;
	hasUnsorted: boolean;
	alerts: GmailBannerViewModel[];
	notices: GmailBannerViewModel[];
}

export interface GmailPollViewModel {
	pollUrl: string | undefined;
	message: string;
}

const GMAIL_SOURCE = "integrations-gmail";

function track(href: string, content: string): string {
	return withInternalTracking(href, { source: GMAIL_SOURCE, content });
}

const STATUS_LABELS: Record<GmailConnectionState, string> = {
	disconnected: "Not connected",
	disconnecting: "Disconnecting…",
	revoked: "Reconnect needed",
	"filter-failed": "Needs attention",
	"awaiting-confirmation": "Step 2 of 2",
	"ready-to-filter": "Connected",
	filtering: "Forwarding",
};

export const GMAIL_PAGE_ERRORS: Record<GmailPageError, string> = {
	sender_invalid: "That doesn't look like an email address. Use the address the newsletter sends from.",
	sender_duplicate: "You're already forwarding that sender.",
	sender_unknown: "I couldn't find that sender any more. Reload the page and try again.",
	inbox_name_invalid: "That inbox name can only use letters, numbers and hyphens. Try a simpler name.",
	inbox_name_taken: "You already have an inbox with that name. Pick another, or add the sender to it.",
	inbox_limit: "You've reached the limit of inboxes on your account. Reuse one of your existing inboxes.",
};

export const GMAIL_GATEWAY_DISABLED_MESSAGE =
	"This forwarding address has been switched off, so Gmail can't deliver to it. Disconnect Gmail below, then connect again to get a working one.";

export const GMAIL_PAGE_NOTICES: Record<GmailPageNotice, string> = {
	connected: "Gmail is connected.",
	confirmed: "Forwarding confirmed.",
	sender_added: "Added. Gmail will start forwarding that sender.",
	sender_removed: "Removed. Gmail will stop forwarding that sender.",
	sender_mapped: "Done. That sender now has its own inbox.",
	inbox_created: "Inbox ready. Add its address in Gmail's forwarding settings to forward directly to this inbox. Readplace confirms it automatically.",
	inbox_confirmation_required: "This inbox still needs Gmail setup. Add its address in Gmail's forwarding settings to forward directly to this inbox. Readplace confirms it automatically.",
};

const GMAIL_POLL_WATCHING = "Watching for Gmail to confirm the forwarding address.";
const GMAIL_POLL_STALLED = "Still waiting. Once you've added the address in Gmail, refresh this page.";

function bannersFor(
	key: string | undefined,
	messages: Record<string, string>,
): GmailBannerViewModel[] {
	if (key === undefined) return [];
	const message = messages[key];
	if (message === undefined) return [];
	return [{ key, message }];
}

function senderDetail(sender: GmailSenderEntry): string {
	if (sender.lastSubject === undefined) return "No mail yet.";
	return `Last: ${sender.lastSubject}`;
}

export function toGmailPollViewModel(input: { pollCount: number }): GmailPollViewModel {
	const canPoll = input.pollCount < GMAIL_CONFIRM_MAX_POLLS;
	return {
		pollUrl: canPoll ? buildGmailStatusUrl(input.pollCount + 1) : undefined,
		message: canPoll ? GMAIL_POLL_WATCHING : GMAIL_POLL_STALLED,
	};
}

export function toGmailPageViewModel(input: {
	connection: GmailConnection;
	senders: readonly GmailSenderEntry[];
	inboxes?: readonly InboxAddressEntry[];
	gatewayLive: boolean;
	error?: string;
	notice?: string;
}): GmailPageViewModel {
	const state = gmailConnectionState(input.connection);
	const awaiting = state === "awaiting-confirmation";
	const revoked = state === "revoked";
	const onFilter = input.senders.filter((sender) => sender.addedToFilterAt !== undefined);
	const namedInboxes = (input.inboxes ?? []).filter(
		(entry) => isLiveAddress(entry) && entry.purpose === "gmail-mapped",
	);
	const destinationOptions: GmailDestinationOptionViewModel[] = [
		{ value: "", label: "Default inbox" },
		...namedInboxes.map((entry) => ({ value: entry.address, label: entry.name })),
		{ value: "new", label: "New inbox…" },
	];
	const unsorted = input.senders.filter(
		(sender) => sender.addedToFilterAt === undefined && sender.mappedAddress === undefined,
	);
	const alerts = [
		...(input.gatewayLive
			? []
			: [{ key: "gateway_disabled", message: GMAIL_GATEWAY_DISABLED_MESSAGE }]),
		...bannersFor(input.error, GMAIL_PAGE_ERRORS),
		...(input.connection.lastFilterError === undefined
			? []
			: [{ key: "filter", message: input.connection.lastFilterError.message }]),
	];
	const notices = bannersFor(input.notice, GMAIL_PAGE_NOTICES);

	return {
		state,
		stateModifier: `gmail__status--${state}`,
		statusLabel: STATUS_LABELS[state],
		integrationsPath: track(INTEGRATIONS_PATH, "back-to-integrations"),
		gatewayAddress: input.connection.gatewayAddress,
		mailboxUrl: buildGmailMailboxUrl(input.connection.accountEmail),
		addSenderAction: track(GMAIL_SENDER_ADD_PATH, "add-sender"),
		disconnectAction: track(GMAIL_DISCONNECT_PATH, "disconnect"),
		reconnectAction: track(GMAIL_CONNECT_PATH, "reconnect"),
		showStep: awaiting && input.gatewayLive,
		showSenders: !awaiting && !revoked,
		showReconnect: revoked,
		senders: onFilter.map((sender) => ({
			email: sender.senderEmail,
			detail: senderDetail(sender),
			mappedAddress: sender.mappedAddress,
			removeAction: track(GMAIL_SENDER_REMOVE_PATH, "remove-sender"),
		})),
		unsorted: unsorted.map((sender) => ({
			email: sender.senderEmail,
			detail: senderDetail(sender),
			mapAction: track(GMAIL_SENDER_MAP_PATH, "map-sender"),
		})),
		destinationOptions,
		hasSenders: onFilter.length > 0,
		hasUnsorted: unsorted.length > 0,
		alerts,
		notices,
	};
}
