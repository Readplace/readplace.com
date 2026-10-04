import type { GmailConnection, GmailConnectionStore } from "@packages/domain/gmail";
import type { ListConnectedGmailAccounts } from "@packages/provider-contracts/gmail-account";
import type { UserId } from "@packages/domain/user";

export function initInMemoryGmailConnection(deps: { now: () => Date }): GmailConnectionStore & { listConnectedPage: ListConnectedGmailAccounts } {
	const rows = new Map<UserId, GmailConnection>();

	const update = (userId: UserId, patch: Partial<GmailConnection>) => {
		const existing = rows.get(userId);
		if (existing === undefined) return;
		rows.set(userId, { ...existing, ...patch });
	};

	return {
		listConnectedPage: async ({ pageToken }) => {
			const offset = pageToken === undefined ? 0 : Number(pageToken);
			const connected = [...rows.values()].filter((row) => row.revokedAt === undefined);
			return { userIds: connected.slice(offset, offset + 25).map((row) => row.userId), nextPageToken: offset + 25 < connected.length ? String(offset + 25) : undefined };
		},
		createConnection: async ({ userId, gatewayAddress }) => {
			const connection: GmailConnection = {
				userId,
				gatewayAddress,
				accountEmail: undefined,
				connectedAt: deps.now().toISOString(),
				forwardingConfirmedAt: undefined,
				lastConfirmError: undefined,
				filterCount: undefined,
				filterSenderCount: undefined,
				filterUpdatedAt: undefined,
				lastFilterError: undefined,
				revokedAt: undefined,
				revokedReason: undefined,
				disconnectRequestedAt: undefined,
			};
			rows.set(userId, connection);
			return connection;
		},
		findConnectionByUserId: async (userId) => rows.get(userId),
		markForwardingConfirmed: async ({ userId }) => {
			const existing = rows.get(userId);
			if (existing?.forwardingConfirmedAt !== undefined) return;
			update(userId, {
				forwardingConfirmedAt: deps.now().toISOString(),
				lastConfirmError: undefined,
			});
		},
		recordConfirmError: async ({ userId, error }) => {
			update(userId, { lastConfirmError: error });
		},
		recordAccountEmail: async ({ userId, accountEmail }) => {
			update(userId, { accountEmail });
		},
		recordFilter: async ({ userId, filterCount, filterSenderCount }) => {
			update(userId, {
				filterCount,
				filterSenderCount,
				filterUpdatedAt: deps.now().toISOString(),
				lastFilterError: undefined,
			});
		},
		clearFilter: async ({ userId }) => {
			update(userId, {
				filterCount: undefined,
				filterSenderCount: undefined,
				filterUpdatedAt: undefined,
				lastFilterError: undefined,
			});
		},
		recordFilterError: async ({ userId, error }) => {
			update(userId, { lastFilterError: error });
		},
		markRevoked: async ({ userId, reason }) => {
			update(userId, { revokedAt: deps.now().toISOString(), revokedReason: reason });
		},
		markRevokedIfCurrent: async ({ userId, gatewayAddress, connectedAt, reason }) => {
			const existing = rows.get(userId);
			if (existing === undefined || existing.gatewayAddress !== gatewayAddress || existing.connectedAt !== connectedAt || existing.disconnectRequestedAt !== undefined) return false;
			update(userId, { revokedAt: deps.now().toISOString(), revokedReason: reason });
			return true;
		},
		clearRevoked: async ({ userId }) => {
			const connectedAt = deps.now().toISOString();
			update(userId, { revokedAt: undefined, revokedReason: undefined, connectedAt });
			return connectedAt;
		},
		markDisconnectRequested: async ({ userId }) => {
			update(userId, { disconnectRequestedAt: deps.now().toISOString() });
		},
		deleteConnection: async (userId) => {
			rows.delete(userId);
		},
		countConnected: async () =>
			[...rows.values()].filter((row) => row.revokedAt === undefined).length,
	};
}
