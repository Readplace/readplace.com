import type { GmailConnection, GmailConnectionStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

export function initInMemoryGmailConnection(deps: { now: () => Date }): GmailConnectionStore {
	const rows = new Map<UserId, GmailConnection>();

	const update = (userId: UserId, patch: Partial<GmailConnection>) => {
		const existing = rows.get(userId);
		if (existing === undefined) return;
		rows.set(userId, { ...existing, ...patch });
	};

	return {
		createConnection: async ({ userId, gatewayAddress, googleAccountEmail }) => {
			const connection: GmailConnection = {
				userId,
				gatewayAddress,
				googleAccountEmail,
				connectedAt: deps.now().toISOString(),
				forwardingConfirmedAt: undefined,
				filterId: undefined,
				filterQuery: undefined,
				filterSenderCount: undefined,
				filterUpdatedAt: undefined,
				lastFilterError: undefined,
				revokedAt: undefined,
				revokedReason: undefined,
			};
			rows.set(userId, connection);
			return connection;
		},
		findConnectionByUserId: async (userId) => rows.get(userId),
		markForwardingConfirmed: async ({ userId }) => {
			const existing = rows.get(userId);
			if (existing?.forwardingConfirmedAt !== undefined) return;
			update(userId, { forwardingConfirmedAt: deps.now().toISOString() });
		},
		clearForwardingConfirmed: async ({ userId }) => {
			update(userId, { forwardingConfirmedAt: undefined });
		},
		recordFilter: async ({ userId, filterId, filterQuery, filterSenderCount }) => {
			update(userId, {
				filterId,
				filterQuery,
				filterSenderCount,
				filterUpdatedAt: deps.now().toISOString(),
				lastFilterError: undefined,
			});
		},
		clearFilter: async ({ userId }) => {
			update(userId, {
				filterId: undefined,
				filterQuery: undefined,
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
		clearRevoked: async ({ userId }) => {
			update(userId, { revokedAt: undefined, revokedReason: undefined });
		},
		deleteConnection: async (userId) => {
			rows.delete(userId);
		},
		countConnected: async () =>
			[...rows.values()].filter((row) => row.revokedAt === undefined).length,
	};
}
