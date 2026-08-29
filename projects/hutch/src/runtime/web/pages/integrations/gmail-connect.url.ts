export const INTEGRATIONS_PATH = "/integrations";
export const GMAIL_CONNECT_PATH = "/integrations/gmail/connect";
export const GMAIL_CALLBACK_PATH = "/integrations/gmail/callback";

export type GmailConnectError =
	| "connect_failed"
	| "oauth_denied"
	| "oauth_state"
	| "oauth_scope"
	| "oauth_exchange";

export function buildIntegrationsUrl(params: { error: GmailConnectError }): string {
	const query = new URLSearchParams({ error: params.error });
	return `${INTEGRATIONS_PATH}?${query.toString()}`;
}
