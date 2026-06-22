import { getBuiltInClient, isBuiltInRedirectUri } from "./built-in-clients";
import type { OAuthClient } from "./oauth.types";

export interface DynamicOAuthClientStore {
	getClient: (clientId: string) => Promise<OAuthClient | undefined>;
	markClientActive: (clientId: string) => Promise<void>;
}

/**
 * Resolves a client by consulting the fixed built-in registry first, then the
 * dynamic store. Built-in wins so a dynamically-registered id can never shadow a
 * first-party extension, and built-ins keep their loopback redirect exception
 * while dynamic clients are held to exact redirect-uri matches.
 */
export function initOAuthClientLookup(deps: { dynamic: DynamicOAuthClientStore }): {
	findClient: (clientId: string) => Promise<OAuthClient | undefined>;
	validateRedirectUri: (params: { clientId: string; redirectUri: string }) => Promise<boolean>;
	markClientActive: (clientId: string) => Promise<void>;
} {
	const findClient = async (clientId: string): Promise<OAuthClient | undefined> => {
		const builtIn = getBuiltInClient(clientId);
		if (builtIn) return builtIn;
		return deps.dynamic.getClient(clientId);
	};

	const validateRedirectUri = async ({
		clientId,
		redirectUri,
	}: {
		clientId: string;
		redirectUri: string;
	}): Promise<boolean> => {
		const builtIn = getBuiltInClient(clientId);
		if (builtIn) return isBuiltInRedirectUri({ client: builtIn, redirectUri });
		const dynamic = await deps.dynamic.getClient(clientId);
		if (!dynamic) return false;
		return dynamic.redirectUris.includes(redirectUri);
	};

	const markClientActive = async (clientId: string): Promise<void> => {
		if (getBuiltInClient(clientId)) return;
		await deps.dynamic.markClientActive(clientId);
	};

	return { findClient, validateRedirectUri, markClientActive };
}
