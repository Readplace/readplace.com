import assert from "node:assert";
import { type OAuthClientId, OAuthClientIdSchema } from "@packages/domain/oauth";
import {
	type ClientGroup,
	clientNameForBuiltInOAuthClientId,
	isBuiltInOAuthClientId,
	SUPPORTED_CLIENTS,
} from "@packages/supported-clients";

const RELATIVE_URL_BASE = "http://relative";
const AUTHORIZE_PATH = "/oauth/authorize";
const ISSUABLE_CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function oauthClientIdFrom(returnUrl: string | undefined): OAuthClientId | undefined {
	if (!returnUrl || !URL.canParse(returnUrl, RELATIVE_URL_BASE)) return undefined;
	const parsed = new URL(returnUrl, RELATIVE_URL_BASE);
	if (parsed.pathname !== AUTHORIZE_PATH) return undefined;
	const clientId = parsed.searchParams.get("client_id");
	if (clientId === null || !ISSUABLE_CLIENT_ID.test(clientId)) return undefined;
	return OAuthClientIdSchema.parse(clientId);
}

export function signInClientGroupFrom(returnUrl: string | undefined): "none" | "selfRegistered" | ClientGroup {
	const clientId = oauthClientIdFrom(returnUrl);
	if (clientId === undefined) return "none";
	if (!isBuiltInOAuthClientId(clientId)) return "selfRegistered";
	const name = clientNameForBuiltInOAuthClientId(clientId);
	const client = SUPPORTED_CLIENTS.find((candidate) => candidate.name === name);
	assert(client, `Client missing from SUPPORTED_CLIENTS: ${name}`);
	return client.group;
}
