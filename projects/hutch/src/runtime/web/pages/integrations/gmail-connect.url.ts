import { GMAIL_FEATURE } from "@packages/web-shell";

export const INTEGRATIONS_PATH = "/integrations";
export const GMAIL_CONNECT_PATH = "/integrations/gmail/connect";
export const GMAIL_CALLBACK_PATH = "/integrations/gmail/callback";

export type GmailConnectError =
	| "connect_failed"
	| "oauth_denied"
	| "oauth_state"
	| "oauth_scope"
	| "oauth_exchange";

/** Every redirect back into the feature carries the flag, or the reader lands on
 * a 404 the moment the callback returns them. */
export function buildIntegrationsUrl(params: { error?: GmailConnectError; connected?: true }): string {
	const query = new URLSearchParams({ feature: GMAIL_FEATURE });
	if (params.error !== undefined) query.set("error", params.error);
	if (params.connected === true) query.set("connected", "1");
	return `${INTEGRATIONS_PATH}?${query.toString()}`;
}
