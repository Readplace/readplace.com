import { type DynamoDBDocumentClient, defineDynamoTable } from "@packages/hutch-storage-client";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { GetSessionUserId } from "@packages/provider-contracts/auth";
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
}): GetSessionUserId {
	const sessions = defineDynamoTable({
		client: deps.client,
		tableName: deps.sessionsTableName,
		schema: SessionRow,
	});

	return async (sessionId) => {
		const row = await sessions.get({ sessionId });
		if (!row) return null;
		if (row.expiresAt < Math.floor(Date.now() / 1000)) return null;
		return {
			userId: authenticatedUserIdFrom(row.userId),
			emailVerified: row.emailVerified === true,
		};
	};
}
