export const INTEGRATIONS_PATH = "/integrations";
export const GMAIL_CONNECT_PATH = "/integrations/gmail/connect";
export const GMAIL_CALLBACK_PATH = "/integrations/gmail/callback";

export type GmailConnectError =
	| "connect_failed"
	| "oauth_denied"
	| "oauth_state"
	| "oauth_scope"
	| "oauth_metadata_scope"
	| "oauth_account_changed"
	| "oauth_exchange";

export type IntegrationsNotice = "gmail_disconnected";

export function buildIntegrationsUrl(params: {
	error?: GmailConnectError;
	notice?: IntegrationsNotice;
}): string {
	const query = new URLSearchParams();
	if (params.error !== undefined) query.set("error", params.error);
	if (params.notice !== undefined) query.set("notice", params.notice);
	return `${INTEGRATIONS_PATH}?${query.toString()}`;
}
