import { type DynamoDBDocumentClient, defineDynamoTable } from "@packages/hutch-storage-client";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { GetSessionUserId, ObserveSession } from "@packages/provider-contracts/auth";
import { SessionRow } from "./session-row";

/** Reads a session row by id and mints the request principal from it. This is an
 * auth boundary — a validated session cookie becomes the AuthenticatedUserId —
 * which is why it may call `authenticatedUserIdFrom` (see the noRestrictedImports
 * allowlist in biome.config.base.json). Returns null for a missing row or one
 * whose `expiresAt` has passed (the DynamoDB TTL is best-effort, so a lingering
 * stale row must still read as no session). Throws on a real DB error — the
 * resilience (degrade to guest) lives one layer up in `initResolveLogin`. */
export function initGetSessionUserId(deps: {
	client: DynamoDBDocumentClient;
	sessionsTableName: string;
	observeSession: ObserveSession;
}): GetSessionUserId {
	const sessions = defineDynamoTable({
		client: deps.client,
		tableName: deps.sessionsTableName,
		schema: SessionRow,
	});

	return async (sessionId) => {
		let row: Awaited<ReturnType<typeof sessions.get>>;
		try {
			row = await sessions.get({ sessionId });
		} catch (error) {
			deps.observeSession({ event: "session_unavailable", sessionId, reason: "lookup_error" });
			throw error;
		}
		if (!row) {
			deps.observeSession({ event: "session_unavailable", sessionId, reason: "row_missing" });
			return null;
		}
		if (row.expiresAt < Math.floor(Date.now() / 1000)) {
			deps.observeSession({ event: "session_unavailable", sessionId, userId: row.userId, expiresAt: row.expiresAt, reason: "expired" });
			return null;
		}
		return {
			userId: authenticatedUserIdFrom(row.userId),
			emailVerified: row.emailVerified === true,
			expiresAt: row.expiresAt,
		};
	};
}
