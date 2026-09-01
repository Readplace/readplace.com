import type { IconName } from "@packages/ui-icons";
import type { GmailConnection, GmailConnectionState } from "@packages/domain/gmail";
import { gmailConnectionState } from "@packages/domain/gmail";
import { GMAIL_CONNECT_PATH } from "./gmail-connect.url";
import { GMAIL_PATH } from "./gmail.url";

export interface IntegrationActionViewModel {
	key: string;
	method: "GET" | "POST";
	href: string;
	label: string;
	variant: "primary" | "secondary";
}

export interface IntegrationRowViewModel {
	key: string;
	name: string;
	description: string;
	iconName: IconName;
	statusKey: GmailConnectionState;
	statusLabel: string;
	statusModifier: string;
	actions: IntegrationActionViewModel[];
}

export interface IntegrationsAlertViewModel {
	key: string;
	message: string;
}

export interface IntegrationsIndexViewModel {
	services: IntegrationRowViewModel[];
	alerts: IntegrationsAlertViewModel[];
}

const STATUS_LABELS: Record<GmailConnectionState, string> = {
	disconnected: "Not set up",
	revoked: "Reconnect needed",
	"filter-failed": "Needs attention",
	"awaiting-confirmation": "Step 2 of 2",
	"ready-to-filter": "Connected",
	filtering: "Connected",
};

const GMAIL_ACTIONS: Record<GmailConnectionState, IntegrationActionViewModel> = {
	disconnected: {
		key: "connect",
		method: "POST",
		href: GMAIL_CONNECT_PATH,
		label: "Connect Gmail",
		variant: "primary",
	},
	"awaiting-confirmation": {
		key: "finish-setup",
		method: "GET",
		href: GMAIL_PATH,
		label: "Finish setup",
		variant: "primary",
	},
	"ready-to-filter": {
		key: "manage",
		method: "GET",
		href: GMAIL_PATH,
		label: "Manage",
		variant: "secondary",
	},
	filtering: {
		key: "manage",
		method: "GET",
		href: GMAIL_PATH,
		label: "Manage",
		variant: "secondary",
	},
	"filter-failed": {
		key: "manage",
		method: "GET",
		href: GMAIL_PATH,
		label: "Manage",
		variant: "primary",
	},
	revoked: {
		key: "reconnect",
		method: "POST",
		href: GMAIL_CONNECT_PATH,
		label: "Reconnect Gmail",
		variant: "primary",
	},
};

export const GMAIL_CONNECT_ERRORS: Record<string, string> = {
	connect_failed: "I couldn't start the Gmail connection. Try again.",
	oauth_denied: "You cancelled the Gmail connection, so nothing changed.",
	oauth_state: "That Gmail connection link expired. Start again.",
	oauth_scope:
		"Readplace needs permission to manage one forwarding rule. Connect again and leave that permission ticked.",
	oauth_exchange: "Google couldn't complete the connection. Try again in a moment.",
};

function alertsFor(error: string | undefined): IntegrationsAlertViewModel[] {
	if (error === undefined) return [];
	const message = GMAIL_CONNECT_ERRORS[error];
	if (message === undefined) return [];
	return [{ key: error, message }];
}

export function toIntegrationsIndexViewModel(input: {
	connection: GmailConnection | undefined;
	error?: string;
}): IntegrationsIndexViewModel {
	const state = gmailConnectionState(input.connection);
	const alerts = alertsFor(input.error);
	return {
		services: [
			{
				key: "gmail",
				name: "Gmail",
				description: "Forward newsletters from Gmail into your Readplace inboxes.",
				iconName: "mail",
				statusKey: state,
				statusLabel: STATUS_LABELS[state],
				statusModifier: `integrations__status--${state}`,
				actions: [GMAIL_ACTIONS[state]],
			},
		],
		alerts,
	};
}
