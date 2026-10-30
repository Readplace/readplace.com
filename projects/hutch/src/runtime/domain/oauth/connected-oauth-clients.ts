import type { OAuthClient, OAuthSignIn } from "@packages/domain/oauth";
import type { UserId } from "@packages/domain/user";
import type { FindOAuthClient, ListUserOAuthClients } from "@packages/provider-contracts/oauth";

export type ConnectedOAuthClient = { client: OAuthClient; latestSignIn: OAuthSignIn | undefined };

export type ListConnectedOAuthClients = (userId: UserId) => Promise<readonly ConnectedOAuthClient[]>;

export function initListConnectedOAuthClients(deps: {
	listUserOAuthClients: ListUserOAuthClients;
	findOAuthClient: FindOAuthClient;
}): ListConnectedOAuthClients {
	return async (userId) => {
		const listed = await deps.listUserOAuthClients(userId);
		const resolved = await Promise.all(
			listed.map(async ({ clientId, latestSignIn }) => ({ client: await deps.findOAuthClient(clientId), latestSignIn })),
		);
		return resolved.flatMap(({ client, latestSignIn }) => (client === undefined ? [] : [{ client, latestSignIn }]));
	};
}
