import { withInternalTracking } from "@packages/web-shell";
import type { IconName } from "@packages/ui-icons";
import type { GmailConnection, GmailConnectionState } from "@packages/domain/gmail";
import { gmailConnectionState } from "@packages/domain/gmail";
import { CUSTOM_EMAILS_ORIGIN_PARAM, CUSTOM_EMAILS_PATH } from "@packages/domain/inbox";
import type { CustomEmailsOrigin } from "@packages/domain/inbox";
import { ACCOUNT_PLANS_URL } from "../account/account.url";
import { GMAIL_CONNECT_PATH } from "./gmail-connect.url";
import { GMAIL_UPGRADE_MESSAGE } from "./gmail-connection-access";
import { GMAIL_PATH } from "./gmail.url";

export interface IntegrationActionViewModel {
	key: string;
	method: "GET" | "POST";
	href: string;
	label: string;
	variant: "primary" | "secondary" | "neutral";
	fields: { name: string; value: string }[];
	trackSource: string;
	trackContent: string;
}

const INTEGRATIONS_SOURCE = "integrations";

function trackedAction(
	action: Omit<IntegrationActionViewModel, "trackSource" | "trackContent">,
): IntegrationActionViewModel {
	return {
		...action,
		href: withInternalTracking(action.href, {
			source: INTEGRATIONS_SOURCE,
			content: action.key,
		}),
		trackSource: INTEGRATIONS_SOURCE,
		trackContent: action.key,
	};
}

type CustomEmailsState = "active" | "not-set-up";

export interface IntegrationRowViewModel {
	key: string;
	name: string;
	description: string;
	iconName: IconName;
	statusKey: GmailConnectionState | CustomEmailsState;
	statusLabel: string;
	statusModifier: string;
	actions: IntegrationActionViewModel[];
}

export interface IntegrationsAlertViewModel {
	key: string;
	message: string;
}

export interface IntegrationsNoticeViewModel {
	key: string;
	message: string;
}

export interface IntegrationsIndexViewModel {
	services: IntegrationRowViewModel[];
	notices: IntegrationsNoticeViewModel[];
	alerts: IntegrationsAlertViewModel[];
}

const STATUS_LABELS: Record<GmailConnectionState, string> = {
	disconnected: "Not set up",
	disconnecting: "Disconnecting…",
	revoked: "Reconnect needed",
	"filter-failed": "Needs attention",
	"confirm-failed": "Needs attention",
	"awaiting-confirmation": "Step 2 of 2",
	"ready-to-filter": "Connected",
	filtering: "Connected",
};

const GMAIL_ACTIONS: Record<
	GmailConnectionState,
	Omit<IntegrationActionViewModel, "trackSource" | "trackContent">[]
> = {
	disconnected: [{
		key: "connect",
		method: "POST",
		href: GMAIL_CONNECT_PATH,
		label: "Connect Gmail",
		variant: "primary",
		fields: [],
	}],
	disconnecting: [],
	"awaiting-confirmation": [{
		key: "finish-setup",
		method: "GET",
		href: GMAIL_PATH,
		label: "Finish setup",
		variant: "primary",
		fields: [],
	}],
	"confirm-failed": [{
		key: "finish-setup",
		method: "GET",
		href: GMAIL_PATH,
		label: "Finish setup",
		variant: "primary",
		fields: [],
	}],
	"ready-to-filter": [{
		key: "manage",
		method: "GET",
		href: GMAIL_PATH,
		label: "Manage",
		variant: "neutral",
		fields: [],
	}],
	filtering: [{
		key: "manage",
		method: "GET",
		href: GMAIL_PATH,
		label: "Manage",
		variant: "neutral",
		fields: [],
	}],
	"filter-failed": [{
		key: "manage",
		method: "GET",
		href: GMAIL_PATH,
		label: "Manage",
		variant: "primary",
		fields: [],
	}],
	revoked: [{
		key: "reconnect",
		method: "POST",
		href: GMAIL_CONNECT_PATH,
		label: "Reconnect Gmail",
		variant: "primary",
		fields: [],
	}],
};

export const GMAIL_CONNECT_ERRORS: Record<string, string> = {
	connect_failed: "I couldn't start the Gmail connection. Try again.",
	oauth_denied: "You cancelled the Gmail connection, so nothing changed.",
	oauth_state: "That Gmail connection link expired. Start again.",
	oauth_scope:
		"Readplace needs permission to manage forwarding rules. Connect again and leave that permission ticked.",
	oauth_metadata_scope:
		"Reconnect Gmail and allow Readplace to read message headers so you can choose senders from your mailbox. Existing mappings stay in place.",
	oauth_metadata_scope_first_connect:
		"Readplace needs permission to read message headers so you can choose senders from your mailbox. Connect again and leave that permission ticked.",
	oauth_account_changed: "Disconnect your current Gmail account before connecting a different one.",
	oauth_exchange: "Google couldn't complete the connection. Try again in a moment.",
	oauth_signed_out:
		"You were signed out before Google sent you back, so nothing was connected. Connect Gmail again.",
};

export const GMAIL_NOTICES: Record<string, string> = {
	gmail_disconnected:
		"Gmail is disconnecting. I'm removing the Readplace filter and Readplace's access to your Google account. I can't remove the forwarding address, so in Gmail open Settings, See all settings, then Forwarding and POP/IMAP, and remove the address that starts with gmail-. If a filter forwarding to that address is still listed under Filters and Blocked Addresses, delete it too.",
};

function alertsFor(error: string | undefined): IntegrationsAlertViewModel[] {
	if (error === undefined) return [];
	const message = GMAIL_CONNECT_ERRORS[error];
	if (message === undefined) return [];
	return [{ key: error, message }];
}

function noticesFor(notice: string | undefined): IntegrationsNoticeViewModel[] {
	if (notice === undefined) return [];
	const message = GMAIL_NOTICES[notice];
	if (message === undefined) return [];
	return [{ key: notice, message }];
}

function gmailRow(connection: GmailConnection | undefined): IntegrationRowViewModel {
	const state = gmailConnectionState(connection);
	return {
		key: "gmail",
		name: "From Gmail",
		description: "Send newsletters from Gmail to your readlists.",
		iconName: "mail",
		statusKey: state,
		statusLabel: STATUS_LABELS[state],
		statusModifier: `integrations__status--${state}`,
		actions: GMAIL_ACTIONS[state].map(trackedAction),
	};
}

function gmailUpgradeRow(connection: GmailConnection | undefined): IntegrationRowViewModel {
	const row = gmailRow(connection);
	const managementActions = row.statusKey === "revoked"
		? GMAIL_ACTIONS["ready-to-filter"].map(trackedAction)
		: row.actions.filter((action) => action.method === "GET");
	return {
		...row,
		description: GMAIL_UPGRADE_MESSAGE,
		actions: [
			trackedAction({
				key: "upgrade-gmail",
				method: "GET",
				href: ACCOUNT_PLANS_URL,
				label: "Upgrade",
				variant: "primary",
				fields: [],
			}),
			...managementActions.map((action): IntegrationActionViewModel => ({ ...action, variant: "secondary" })),
		],
	};
}

function customEmailsRow(activeCount: number): IntegrationRowViewModel {
	const state: CustomEmailsState = activeCount > 0 ? "active" : "not-set-up";
	return {
		key: "custom-emails",
		name: "From Custom Emails",
		description: "Sign up for newsletters with your own Readplace emails.",
		iconName: "inbox",
		statusKey: state,
		statusLabel: state === "active" ? `${activeCount} active` : "Not set up",
		statusModifier: `integrations__status--${state}`,
		actions: [trackedAction({
			key: "custom-emails",
			method: "GET",
			href: CUSTOM_EMAILS_PATH,
			label: "Manage",
			variant: "neutral",
			fields: [{ name: CUSTOM_EMAILS_ORIGIN_PARAM, value: "newsletters" satisfies CustomEmailsOrigin }],
		})],
	};
}

export function toIntegrationsIndexViewModel(input: {
	connection: GmailConnection | undefined;
	activeCustomEmailCount: number;
	canConnectGmail: boolean;
	error?: string;
	notice?: string;
}): IntegrationsIndexViewModel {
	const alerts = alertsFor(input.error);
	const notices = noticesFor(input.notice);
	return {
		services: [
			input.canConnectGmail ? gmailRow(input.connection) : gmailUpgradeRow(input.connection),
			customEmailsRow(input.activeCustomEmailCount),
		],
		notices,
		alerts,
	};
}
