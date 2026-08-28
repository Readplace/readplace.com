import type {
	GmailConnection,
	GmailConnectionState,
	GmailSenderEntry,
} from "@packages/domain/gmail";
import { gmailConnectionState } from "@packages/domain/gmail";
import {
	GMAIL_DISCONNECT_PATH,
	GMAIL_SENDER_ADD_PATH,
	GMAIL_SENDER_MAP_PATH,
	GMAIL_SENDER_REMOVE_PATH,
	GMAIL_SETTINGS_URL,
	GMAIL_VERIFY_PATH,
	type GmailPageError,
	type GmailPageNotice,
} from "./gmail.url";
import { GMAIL_CONNECT_PATH } from "./gmail-connect.url";

export interface GmailSenderRowViewModel {
	email: string;
	detail: string;
	mappedAddress: string;
	mappedVisibility: "visible" | "hidden";
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
	googleAccountEmail: string;
	gatewayAddress: string;
	settingsUrl: string;
	verifyAction: string;
	addSenderAction: string;
	disconnectAction: string;
	reconnectAction: string;
	stepVisibility: "visible" | "hidden";
	sendersVisibility: "visible" | "hidden";
	reconnectVisibility: "visible" | "hidden";
	senders: GmailSenderRowViewModel[];
	unsorted: GmailUnsortedRowViewModel[];
	hasSenders: boolean;
	hasUnsorted: boolean;
	unsortedVisibility: "visible" | "hidden";
	alerts: GmailBannerViewModel[];
	notices: GmailBannerViewModel[];
	alertVisibility: "visible" | "hidden";
	noticeVisibility: "visible" | "hidden";
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
	verifying: "Checking with Gmail. This page updates once the rule is in place.",
	sender_added: "Added. Gmail will start forwarding that sender.",
	sender_removed: "Removed. Gmail will stop forwarding that sender.",
	sender_mapped: "Done. That sender now has its own inbox.",
};

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

export function toGmailPageViewModel(input: {
	connection: GmailConnection;
	senders: readonly GmailSenderEntry[];
	error?: string;
	notice?: string;
}): GmailPageViewModel {
	const state = gmailConnectionState(input.connection);
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
	const notices = bannersFor(input.notice, GMAIL_PAGE_NOTICES);
	const awaiting = state === "awaiting-confirmation";
	const revoked = state === "revoked";

	return {
		state,
		stateModifier: `gmail__status--${state}`,
		statusLabel: STATUS_LABELS[state],
		googleAccountEmail: input.connection.googleAccountEmail,
		gatewayAddress: input.connection.gatewayAddress,
		settingsUrl: GMAIL_SETTINGS_URL,
		verifyAction: GMAIL_VERIFY_PATH,
		addSenderAction: GMAIL_SENDER_ADD_PATH,
		disconnectAction: GMAIL_DISCONNECT_PATH,
		reconnectAction: GMAIL_CONNECT_PATH,
		stepVisibility: awaiting ? "visible" : "hidden",
		sendersVisibility: awaiting || revoked ? "hidden" : "visible",
		reconnectVisibility: revoked ? "visible" : "hidden",
		senders: onFilter.map((sender) => ({
			email: sender.senderEmail,
			detail: senderDetail(sender),
			mappedAddress: sender.mappedAddress ?? "",
			mappedVisibility: sender.mappedAddress === undefined ? "hidden" : "visible",
			removeAction: GMAIL_SENDER_REMOVE_PATH,
		})),
		unsorted: unsorted.map((sender) => ({
			email: sender.senderEmail,
			detail: senderDetail(sender),
			mapAction: GMAIL_SENDER_MAP_PATH,
		})),
		hasSenders: onFilter.length > 0,
		hasUnsorted: unsorted.length > 0,
		unsortedVisibility: unsorted.length > 0 ? "visible" : "hidden",
		alerts,
		notices,
		alertVisibility: alerts.length > 0 ? "visible" : "hidden",
		noticeVisibility: notices.length > 0 ? "visible" : "hidden",
	};
}
