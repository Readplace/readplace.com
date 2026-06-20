import type { OAuthClient } from "@packages/domain/oauth";
import { getBuiltInClient, isBuiltInRedirectUri } from "@packages/domain/oauth";
import type {
	FindOAuthClient,
	MarkOAuthClientActive,
	ValidateOAuthRedirectUri,
} from "@packages/provider-contracts/oauth";

export interface DynamicOAuthClientStore {
	getClient: (clientId: string) => Promise<OAuthClient | undefined>;
	markClientActive: MarkOAuthClientActive;
}

/**
 * Resolves a client by consulting the fixed built-in registry first, then the
 * dynamic store. Built-in wins so a dynamically-registered id can never shadow a
 * first-party extension, and built-ins keep their loopback redirect exception
 * while dynamic clients are held to exact redirect-uri matches.
 */
export function initOAuthClientLookup(deps: { dynamic: DynamicOAuthClientStore }): {
	findClient: FindOAuthClient;
	validateRedirectUri: ValidateOAuthRedirectUri;
	markClientActive: MarkOAuthClientActive;
} {
	const findClient: FindOAuthClient = async (clientId) => {
		const builtIn = getBuiltInClient(clientId);
		if (builtIn) return builtIn;
		return deps.dynamic.getClient(clientId);
	};

	const validateRedirectUri: ValidateOAuthRedirectUri = async ({ clientId, redirectUri }) => {
		const builtIn = getBuiltInClient(clientId);
		if (builtIn) return isBuiltInRedirectUri({ client: builtIn, redirectUri });
		const dynamic = await deps.dynamic.getClient(clientId);
		if (!dynamic) return false;
		return dynamic.redirectUris.includes(redirectUri);
	};

	const markClientActive: MarkOAuthClientActive = async (clientId) => {
		if (getBuiltInClient(clientId)) return;
		await deps.dynamic.markClientActive(clientId);
	};

	return { findClient, validateRedirectUri, markClientActive };
}
