const RELATIVE_URL_BASE = "http://relative";
const AUTHORIZE_PATH = "/oauth/authorize";
const ISSUABLE_CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function oauthClientIdFrom(returnUrl: string | undefined): string | undefined {
	if (!returnUrl || !URL.canParse(returnUrl, RELATIVE_URL_BASE)) return undefined;
	const parsed = new URL(returnUrl, RELATIVE_URL_BASE);
	if (parsed.pathname !== AUTHORIZE_PATH) return undefined;
	const clientId = parsed.searchParams.get("client_id");
	if (clientId === null || !ISSUABLE_CLIENT_ID.test(clientId)) return undefined;
	return clientId;
}
