import type { SaveProvenance } from "@packages/domain/article";
import type { FindOAuthClient } from "@packages/provider-contracts/oauth";
import { clientNameForBuiltInOAuthClientId, isBuiltInOAuthClientId } from "@packages/supported-clients";

/** 1. Only a cookie session reaches a save route without a bearer, and only the
 *     web app holds one — a Siren request without a token is refused earlier.
 *  2. Every other id belongs to a client that registered itself at runtime. The
 *     hypermedia routes hold only the id, so they carry that; `/mcp` can afford
 *     the lookup and carries the name the client registered under. Either way the
 *     reader resolves it to a known assistant or to a generic label, so an
 *     unrecognised value is never rendered. */
export function resolveSaveProvenance(oauthClientId: string | undefined): SaveProvenance {
	if (oauthClientId === undefined) return { kind: "web" }; /* 1 */
	if (isBuiltInOAuthClientId(oauthClientId)) {
		return { kind: "client", clientName: clientNameForBuiltInOAuthClientId(oauthClientId) };
	}
	return { kind: "mcp", registeredName: oauthClientId }; /* 2 */
}

export function initResolveMcpSaveProvenance(deps: {
	findOAuthClient: FindOAuthClient;
}): (oauthClientId: string) => Promise<SaveProvenance> {
	return async (oauthClientId) => {
		if (isBuiltInOAuthClientId(oauthClientId)) {
			return { kind: "client", clientName: clientNameForBuiltInOAuthClientId(oauthClientId) };
		}
		const client = await deps.findOAuthClient(oauthClientId);
		return { kind: "mcp", registeredName: client?.name ?? oauthClientId }; /* 2 */
	};
}
