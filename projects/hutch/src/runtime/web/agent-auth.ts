import { readFileSync } from "node:fs";
import { join } from "node:path";

const AUTH_MD_TEMPLATE = readFileSync(join(__dirname, "auth-md.template.md"), "utf-8");

/**
 * A Readplace access token grants full read/write access to one user's reading
 * queue; the authorization flow never sub-divides that access, so a single
 * coarse scope is the honest description. Advertised in the protected-resource
 * metadata and documented in auth.md.
 */
export const AGENT_SCOPES_SUPPORTED = ["queue"] as const;

interface AgentAuthRegistrationMethod {
	type: "oauth2_authorization_code_pkce";
	authorization_uri: string;
	token_uri: string;
	grant_types_supported: readonly string[];
	code_challenge_methods_supported: readonly string[];
	token_endpoint_auth_methods_supported: readonly string[];
}

interface AgentAuthMetadata {
	skill: string;
	register_uri: string;
	identity_types_supported: readonly string[];
	credential_types_supported: readonly string[];
	revocation_uri: string;
	registration_methods: readonly AgentAuthRegistrationMethod[];
}

/**
 * The `agent_auth` extension to the RFC 8414 authorization-server metadata.
 * Readplace registers an agent as a delegate of a human user via the standard
 * authorization-code + PKCE flow, so there is no claim ceremony (`claim_uri` is
 * omitted) but revocation is offered.
 */
export function buildAgentAuthMetadata(baseUrl: string): AgentAuthMetadata {
	return {
		skill: `${baseUrl}/auth.md`,
		register_uri: `${baseUrl}/oauth/register`,
		identity_types_supported: ["delegated_user"],
		credential_types_supported: ["oauth2_access_token", "oauth2_refresh_token"],
		revocation_uri: `${baseUrl}/oauth/revoke`,
		registration_methods: [
			{
				type: "oauth2_authorization_code_pkce",
				authorization_uri: `${baseUrl}/oauth/authorize`,
				token_uri: `${baseUrl}/oauth/token`,
				grant_types_supported: ["authorization_code", "refresh_token"],
				code_challenge_methods_supported: ["S256"],
				token_endpoint_auth_methods_supported: ["none"],
			},
		],
	};
}

export function renderAuthMarkdown(baseUrl: string): string {
	return AUTH_MD_TEMPLATE.replaceAll("{{baseUrl}}", baseUrl);
}
