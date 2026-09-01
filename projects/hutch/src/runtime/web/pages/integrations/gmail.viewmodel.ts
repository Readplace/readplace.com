import type {
	GmailConnection,
	GmailConnectionState,
	GmailSenderEntry,
} from "@packages/domain/gmail";
import { gmailConnectionState } from "@packages/domain/gmail";
import {
	buildGmailStatusUrl,
	GMAIL_CONFIRM_MAX_POLLS,
	GMAIL_DISCONNECT_PATH,
	GMAIL_SENDER_ADD_PATH,
	GMAIL_SENDER_MAP_PATH,
	GMAIL_SENDER_REMOVE_PATH,
	GMAIL_SETTINGS_URL,
	GMAIL_VERIFY_PATH,
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

export interface GmailPageViewModel {
	state: GmailConnectionState;
	stateModifier: string;
	statusLabel: string;
	integrationsPath: string;
	gatewayAddress: string;
	settingsUrl: string;
	verifyAction: string;
	addSenderAction: string;
	disconnectAction: string;
	reconnectAction: string;
	showStep: boolean;
	showSenders: boolean;
	showReconnect: boolean;
	senders: GmailSenderRowViewModel[];
	unsorted: GmailUnsortedRowViewModel[];
	hasSenders: boolean;
	hasUnsorted: boolean;
	alerts: GmailBannerViewModel[];
	notices: GmailBannerViewModel[];
}

export interface GmailPollViewModel {
	pollUrl: string | undefined;
	message: string;
}

const STATUS_LABELS: Record<GmailConnectionState, string> = {
	disconnected: "Not connected",
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
};

export const GMAIL_PAGE_NOTICES: Record<GmailPageNotice, string> = {
	connected: "Gmail is connected.",
	verifying: "Checking with Gmail. This page updates on its own once forwarding is confirmed.",
	confirmed: "Forwarding confirmed.",
	sender_added: "Added. Gmail will start forwarding that sender.",
	sender_removed: "Removed. Gmail will stop forwarding that sender.",
	sender_mapped: "Done. That sender now has its own inbox.",
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
	error?: string;
	notice?: string;
}): GmailPageViewModel {
	const state = gmailConnectionState(input.connection);
	const awaiting = state === "awaiting-confirmation";
	const revoked = state === "revoked";
	const onFilter = input.senders.filter((sender) => sender.addedToFilterAt !== undefined);
	const unsorted = input.senders.filter(
		(sender) => sender.addedToFilterAt === undefined && sender.mappedAddress === undefined,
	);
	const alerts = [
		...bannersFor(input.error, GMAIL_PAGE_ERRORS),
		...(input.connection.lastFilterError === undefined
			? []
			: [{ key: "filter", message: input.connection.lastFilterError.message }]),
	];
	const notices = bannersFor(input.notice, GMAIL_PAGE_NOTICES).filter(
		(banner) => banner.key !== "verifying" || awaiting,
	);

	return {
		state,
		stateModifier: `gmail__status--${state}`,
		statusLabel: STATUS_LABELS[state],
		integrationsPath: INTEGRATIONS_PATH,
		gatewayAddress: input.connection.gatewayAddress,
		settingsUrl: GMAIL_SETTINGS_URL,
		verifyAction: GMAIL_VERIFY_PATH,
		addSenderAction: GMAIL_SENDER_ADD_PATH,
		disconnectAction: GMAIL_DISCONNECT_PATH,
		reconnectAction: GMAIL_CONNECT_PATH,
		showStep: awaiting,
		showSenders: !awaiting && !revoked,
		showReconnect: revoked,
		senders: onFilter.map((sender) => ({
			email: sender.senderEmail,
			detail: senderDetail(sender),
			mappedAddress: sender.mappedAddress,
			removeAction: GMAIL_SENDER_REMOVE_PATH,
		})),
		unsorted: unsorted.map((sender) => ({
			email: sender.senderEmail,
			detail: senderDetail(sender),
			mapAction: GMAIL_SENDER_MAP_PATH,
		})),
		hasSenders: onFilter.length > 0,
		hasUnsorted: unsorted.length > 0,
		alerts,
		notices,
	};
}
