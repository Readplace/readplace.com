import { randomUUID } from "node:crypto";
import type { User } from "@node-oauth/oauth2-server";
import {
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	TransactionCanceledException,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { initKeepCurrentGrant, isCurrentGrant, isExemptGrant, laterSignIn, type OAuthClientId, OAuthClientIdSchema, type OAuthGrantId as GrantId, type OAuthSignIn } from "@packages/domain/oauth";
import type {
	ListUserOAuthClients,
	RevokeAllUserOAuthTokens,
	RevokeOtherUserOAuthGrants,
	RevokeUserOAuthClient,
} from "@packages/provider-contracts/oauth";
import { z } from "zod";
import { OAuthGrantId, initRefreshProof } from "../../oauth-refresh/evidence";

export { OAuthTokenRow } from "./oauth-token-row";
import { OAuthTokenRow } from "./oauth-token-row";
import { initDynamoRefreshStore } from "./dynamodb-refresh-store";

export function initOAuthCredentialLifecycle(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	secret: string;
}) {
	const { client, tableName } = deps;
	const tokens = defineDynamoTable({ client, tableName, schema: OAuthTokenRow });
	const byUser = defineDynamoTable({ client, tableName, schema: z.object({ pk: z.string(), userId: z.string() }) });
	const byUserClient = defineDynamoTable({ client, tableName, schema: z.object({ pk: z.string(), userId: z.string(), clientId: z.string() }) });
	const proof = initRefreshProof(deps.secret);
	const atomic = initDynamoRefreshStore(deps);

	function historyValues(row: OAuthTokenRow) {
		return {
			":grant": row.grantId ?? OAuthGrantId.parse(randomUUID()),
			":fingerprint": proof.fingerprint(row.refreshToken),
			":expiry": row.refreshTokenExpiresAt * 1000,
			":ttl": row.refreshTokenExpiresAt + 30 * 86400,
		};
	}

	async function revokeRow(row: OAuthTokenRow, cause: "logout-all" | "account-deletion"): Promise<boolean> {
		const existingGrant = row.grantId ? await atomic.store.readGrant(row.grantId) : undefined;
		try {
			await client.send(new TransactWriteCommand({ TransactItems: [
				...(existingGrant ? [{ Update: { TableName: tableName, Key: { pk: `grant#${row.grantId}` }, UpdateExpression: "SET #state = :revoked", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":revoked": "revoked" }, ConditionExpression: "attribute_exists(pk)" } }] : []),
				{ Delete: { TableName: tableName, Key: { pk: row.pk }, ConditionExpression: "attribute_exists(pk)" } },
				{ Delete: { TableName: tableName, Key: { pk: `refresh#${row.refreshToken}` } } },
				{ Update: {
					TableName: tableName,
					Key: { pk: `credential#${proof.fingerprint(row.refreshToken)}` },
					UpdateExpression: "SET grantId = if_not_exists(grantId, :grant), fingerprint = :fingerprint, credentialExpiresAt = if_not_exists(credentialExpiresAt, :expiry), expiresAt = if_not_exists(expiresAt, :ttl), revocation = :revocation",
					ExpressionAttributeValues: { ...historyValues(row), ":revocation": { cause, completedAt: Date.now() } },
				} },
			] }));
		} catch (error) {
			if (error instanceof TransactionCanceledException && error.CancellationReasons?.some(reason => reason.Code === "ConditionalCheckFailed")) return false;
			throw error;
		}
		return true;
	}

	async function sweep(input: { userId: string; cause: "logout-all" | "account-deletion"; spare: GrantId | undefined }): Promise<void> {
		await forEachQueryPage(byUser, {
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": input.userId },
		}, async rows => {
			await Promise.all(rows.map(async row => {
				if (row.pk.startsWith("token#")) {
					const token = await tokens.get({ pk: row.pk }, { consistentRead: true });
					if (!token || (input.spare !== undefined && token.grantId === input.spare)) return;
					await revokeRow(token, input.cause);
				} else if (row.pk.startsWith("code#")) {
					await byUser.delete({ Key: { pk: row.pk } });
				}
			}));
		});
	}

	const revokeAll: RevokeAllUserOAuthTokens = async (userId, cause) => {
		await atomic.advanceEpoch({ userId, deleted: cause === "account-deletion" });
		await sweep({ userId, cause, spare: undefined });
	};

	const keepCurrentGrant = initKeepCurrentGrant({ store: atomic.store, advanceEpochKeeping: atomic.advanceEpochKeeping });
	const revokeOther: RevokeOtherUserOAuthGrants = async ({ userId, keep }) => {
		const kept = keep !== undefined && (await keepCurrentGrant({ userId, grantId: keep })) ? keep : undefined;
		if (kept === undefined) await atomic.advanceEpoch({ userId, deleted: false });
		await sweep({ userId, cause: "logout-all", spare: kept });
		return { kept };
	};

	const listClients: ListUserOAuthClients = async userId => {
		const latest = new Map<OAuthClientId, OAuthSignIn | undefined>();
		await forEachQueryPage(byUser, {
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
		}, async rows => {
			await Promise.all(rows.map(async row => {
				if (!row.pk.startsWith("token#")) return;
				const token = await tokens.get({ pk: row.pk }, { consistentRead: true });
				if (token && Math.max(token.accessTokenExpiresAt, token.refreshTokenExpiresAt) * 1000 > Date.now()) {
					const clientId = OAuthClientIdSchema.parse(token.clientId);
					latest.set(clientId, laterSignIn(latest.get(clientId), token.signedIn));
				}
			}));
		});
		return [...latest].map(([clientId, latestSignIn]) => ({ clientId, latestSignIn }));
	};

	async function disconnect(row: OAuthTokenRow): Promise<void> {
		for (let attempt = 0; attempt < 4; attempt++) {
			const located = await atomic.store.locate(row.refreshToken);
			const grantId = located.credential?.grantId ?? located.history?.grantId;
			if (!grantId) return;
			const existing = await atomic.store.readGrant(grantId);
			const parent = existing ? await atomic.store.readCredential(existing.accessToken) : located.credential;
			const grant = existing ?? (parent ? { id: grantId, userId: parent.userId, clientId: parent.clientId, epoch: parent.epoch,
				generation: parent.generation, accessToken: parent.accessToken, refreshFingerprint: proof.fingerprint(parent.refreshToken), state: "active" as const, expiresAt: parent.refreshExpiresAt } : undefined);
			if (!grant || grant.state === "revoked") return;
			const account = await atomic.store.readAccount(grant.userId);
			if (!isCurrentGrant({ account, credential: { grantId: grant.id, epoch: grant.epoch } })) {
				if (existing && isExemptGrant({ account, grantId: grant.id })) continue;
				return;
			}
			const result = await atomic.store.commit({ expectedGrant: existing, grant: { ...grant, state: "revoked" }, parent, cause: "disconnect", now: Date.now(), accountEpoch: account.epoch });
			if (result === "committed") return;
		}
		throw new Error("Concurrent disconnect could not settle");
	}

	const revokeClient: RevokeUserOAuthClient = async ({ userId, clientId }) => {
		await forEachQueryPage(byUserClient, {
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
		}, async rows => {
			await Promise.all(rows.filter(row => row.clientId === clientId).map(async row => {
				if (row.pk.startsWith("token#")) {
					const token = await tokens.get({ pk: row.pk }, { consistentRead: true });
					if (token) await disconnect(token);
				} else if (row.pk.startsWith("code#")) {
					await byUserClient.delete({ Key: { pk: row.pk } });
				}
			}));
		});
	};

	return {
		grant(user: User) {
			return { grantId: typeof user.grantId === "string" ? OAuthGrantId.parse(user.grantId) : OAuthGrantId.parse(randomUUID()) };
		},
		revokeAll,
		revokeOther,
		listClients,
		revokeClient,
	};
}
