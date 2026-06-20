import type { OAuthClient } from "@packages/domain/oauth";
import { getBuiltInClient, isBuiltInRedirectUri } from "@packages/domain/oauth";
import type {
	FindOAuthClient,
	MarkOAuthClientActive,
	ValidateOAuthRedirectUri,
} from "@packages/provider-contracts/oauth";

interface DynamicOAuthClientStore {
	getClient: (clientId: string) => Promise<OAuthClient | undefined>;
	markClientActive: MarkOAuthClientActive;
}

/**
 * In-memory counterpart of the runtime OAuth client lookup: built-in clients
 * resolve first, then the dynamic store, so fixtures exercise the same
 * built-in-vs-dynamic semantics the production composition root wires.
 */
export function initInMemoryOAuthClientLookup(deps: {
	dynamic: DynamicOAuthClientStore;
}): {
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
