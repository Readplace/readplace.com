import type { OAuthClientId } from "@packages/domain/oauth";
import type { FindOAuthClient } from "@packages/provider-contracts/oauth";
import { isBuiltInOAuthClientId } from "@packages/supported-clients";
import { findRosterAssistant } from "../shared/assistant-roster";

export type SignupClient = "chatgpt" | "claude" | "other";

export type ResolveSignupClient = (oauthClientId: OAuthClientId | null) => Promise<SignupClient>;

export function initResolveSignupClient(deps: { findOAuthClient: FindOAuthClient }): ResolveSignupClient {
	return async (oauthClientId) => {
		if (oauthClientId === null || isBuiltInOAuthClientId(oauthClientId)) return "other";
		const client = await deps.findOAuthClient(oauthClientId);
		if (client === undefined) return "other";
		const assistant = findRosterAssistant(client.name);
		if (assistant?.name === "chatgpt" || assistant?.name === "claude") return assistant.name;
		return "other";
	};
}

export function signupClientOrOther(input: {
	resolve: () => Promise<SignupClient>;
	logError: (message: string, error?: Error) => void;
}): Promise<SignupClient> {
	return input.resolve().catch((err): SignupClient => {
		input.logError("[Email] Signup client lookup failed", err instanceof Error ? err : new Error(String(err)));
		return "other";
	});
}
