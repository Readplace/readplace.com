import assert from "node:assert";
import { type OAuthClientId, OAuthClientIdSchema } from "@packages/domain/oauth";
import {
	type ClientGroup,
	clientNameForBuiltInOAuthClientId,
	isBuiltInOAuthClientId,
	SUPPORTED_CLIENTS,
} from "@packages/supported-clients";
import { returnUrlQueryParam } from "./return-url-param";

const AUTHORIZE_PATH = "/oauth/authorize";
const ISSUABLE_CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function oauthClientIdFrom(returnUrl: string | undefined): OAuthClientId | undefined {
	const clientId = returnUrlQueryParam({ returnUrl, path: AUTHORIZE_PATH, param: "client_id" });
	if (!clientId || !ISSUABLE_CLIENT_ID.test(clientId)) return undefined;
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
