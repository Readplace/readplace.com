import type { OAuthModel } from "@packages/provider-contracts/oauth";
import { refreshContext } from "./evidence";

export function initRecoverAuthenticatedToken(deps: {
	getAccessToken: OAuthModel["getAccessToken"];
	recover: (input: { proof: string; authenticatedRefreshToken: string }) => Promise<void>;
}): OAuthModel["getAccessToken"] {
	return async accessToken => {
		const token = await deps.getAccessToken(accessToken);
		if (!token) return token;
		const proof = refreshContext.getStore()?.recoveryProof;
		if (proof && token.refreshToken) await deps.recover({ proof, authenticatedRefreshToken: token.refreshToken });
		return token;
	};
}
