import type { IconName } from "@packages/ui-icons";
import { GMAIL_CONNECT_PATH } from "./gmail-connect.url";

export type IntegrationStatusKey = "connected" | "not-set-up";

export interface IntegrationRowViewModel {
	key: string;
	name: string;
	description: string;
	iconName: IconName;
	statusKey: IntegrationStatusKey;
	statusLabel: string;
	statusModifier: string;
	connectVisibility: "visible" | "hidden";
	connectAction: string;
	connectLabel: string;
}

export interface IntegrationsAlertViewModel {
	key: string;
	message: string;
}

export interface IntegrationsIndexViewModel {
	services: IntegrationRowViewModel[];
	alerts: IntegrationsAlertViewModel[];
	notices: IntegrationsAlertViewModel[];
	hasAlert: boolean;
	hasNotice: boolean;
	alertVisibility: "visible" | "hidden";
	noticeVisibility: "visible" | "hidden";
}

const STATUS_LABELS: Record<IntegrationStatusKey, string> = {
	connected: "Connected",
	"not-set-up": "Not set up",
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

function noticesFor(connected: boolean): IntegrationsAlertViewModel[] {
	if (!connected) return [];
	return [{ key: "connected", message: "Gmail is connected." }];
}

export function toIntegrationsIndexViewModel(input: {
	gmailConnected: boolean;
	error?: string;
	justConnected?: boolean;
}): IntegrationsIndexViewModel {
	const gmailStatus: IntegrationStatusKey = input.gmailConnected ? "connected" : "not-set-up";
	const alerts = alertsFor(input.error);
	const notices = noticesFor(input.justConnected === true);
	return {
		services: [
			{
				key: "gmail",
				name: "Gmail",
				description: "Forward newsletters from Gmail into your Readplace inboxes.",
				iconName: "mail",
				statusKey: gmailStatus,
				statusLabel: STATUS_LABELS[gmailStatus],
				statusModifier: `integrations__status--${gmailStatus}`,
				connectVisibility: input.gmailConnected ? "hidden" : "visible",
				connectAction: GMAIL_CONNECT_PATH,
				connectLabel: "Connect Gmail",
			},
		],
		alerts,
		notices,
		hasAlert: alerts.length > 0,
		hasNotice: notices.length > 0,
		alertVisibility: alerts.length > 0 ? "visible" : "hidden",
		noticeVisibility: notices.length > 0 ? "visible" : "hidden",
	};
}
