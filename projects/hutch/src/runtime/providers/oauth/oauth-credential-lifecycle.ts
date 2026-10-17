import assert from "node:assert";
import { randomUUID } from "node:crypto";
import type { User } from "@node-oauth/oauth2-server";
import {
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	TransactionCanceledException,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { isCurrentGrant, type OAuthClientId, OAuthClientIdSchema } from "@packages/domain/oauth";
import type {
	ListUserOAuthClients,
	RevokeAllUserOAuthTokens,
	RevokeUserOAuthClient,
} from "@packages/provider-contracts/oauth";
import { z } from "zod";
import {
	CredentialFingerprint,
	CredentialHistory,
	OAuthGrantId,
	type RevocationCause,
	initRefreshProof,
	refreshContext,
} from "../../oauth-refresh/evidence";

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
	const refreshIndex = defineDynamoTable({ client, tableName, schema: z.object({ pk: z.string(), accessToken: z.string() }) });
	const history = defineDynamoTable({ client, tableName, schema: CredentialHistory });
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

	async function remember(row: OAuthTokenRow): Promise<CredentialHistory> {
		const { Attributes } = await history.update({
			Key: { pk: `credential#${proof.fingerprint(row.refreshToken)}` },
			UpdateExpression: "SET grantId = if_not_exists(grantId, :grant), fingerprint = :fingerprint, credentialExpiresAt = if_not_exists(credentialExpiresAt, :expiry), expiresAt = if_not_exists(expiresAt, :ttl)",
			ExpressionAttributeValues: historyValues(row),
			ReturnValues: "ALL_NEW",
		});
		assert(Attributes);
		return Attributes;
	}

	async function findToken(refreshToken: string) {
		const index = await refreshIndex.get({ pk: `refresh#${refreshToken}` }, { consistentRead: true });
		if (!index) return undefined;
		return tokens.get({ pk: `token#${index.accessToken}` }, { consistentRead: true });
	}

	async function revokeRow(row: OAuthTokenRow, cause: RevocationCause): Promise<boolean> {
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

	const revokeAll: RevokeAllUserOAuthTokens = async (userId, cause) => {
		await atomic.advanceEpoch({ userId, deleted: cause === "account-deletion" });
		await forEachQueryPage(byUser, {
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
		}, async rows => {
			await Promise.all(rows.map(async row => {
				if (row.pk.startsWith("token#")) {
					const token = await tokens.get({ pk: row.pk }, { consistentRead: true });
					if (token) await revokeRow(token, cause);
				} else if (row.pk.startsWith("code#")) {
					await byUser.delete({ Key: { pk: row.pk } });
				}
			}));
		});
	};

	const listClients: ListUserOAuthClients = async userId => {
		const clientIds = new Set<OAuthClientId>();
		await forEachQueryPage(byUser, {
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
		}, async rows => {
			await Promise.all(rows.map(async row => {
				if (!row.pk.startsWith("token#")) return;
				const token = await tokens.get({ pk: row.pk }, { consistentRead: true });
				if (token && Math.max(token.accessTokenExpiresAt, token.refreshTokenExpiresAt) * 1000 > Date.now()) {
					clientIds.add(OAuthClientIdSchema.parse(token.clientId));
				}
			}));
		});
		return [...clientIds];
	};

	async function disconnect(row: OAuthTokenRow): Promise<void> {
		for (let attempt = 0; attempt < 4; attempt++) {
			const located = await atomic.store.locate(row.refreshToken);
			const grantId = located.credential?.grantId ?? located.history?.grantId;
			if (!grantId) return;
			const existing = await atomic.store.readGrant(grantId);
			const parent = existing ? await atomic.store.readCredential(existing.accessToken) : located.credential;
			if (!parent || existing?.state === "revoked") return;
			const account = await atomic.store.readAccount(parent.userId);
			if (!isCurrentGrant({ account, credential: parent })) return;
			const grant = existing ?? { id: grantId, userId: parent.userId, clientId: parent.clientId, epoch: parent.epoch,
				generation: parent.generation, accessToken: parent.accessToken, refreshFingerprint: proof.fingerprint(parent.refreshToken), state: "active" as const, expiresAt: parent.refreshExpiresAt };
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
			return {
				grantId: typeof user.grantId === "string" ? OAuthGrantId.parse(user.grantId) : OAuthGrantId.parse(randomUUID()),
				parentFingerprint: typeof user.parentFingerprint === "string" ? CredentialFingerprint.parse(user.parentFingerprint) : undefined,
			};
		},
		async findRefresh(refreshToken: string) {
			const row = await findToken(refreshToken);
			const context = refreshContext.getStore();
			const credential = row
				? await remember(row)
				: await history.get({ pk: `credential#${proof.fingerprint(refreshToken)}` }, { consistentRead: true });
			let reason = "unknown";
			if (credential) {
				reason = credential.revocation?.cause ?? "invalid_grant";
				if (credential.credentialExpiresAt <= Date.now()) reason = "expired";
			}
			if (context) { context.credential = credential; context.reason = reason; }
			if (!row || reason === "expired") return undefined;
			assert(credential);
			return { row, credential };
		},
		async revoke(refreshToken: string) {
			const row = await findToken(refreshToken);
			if (!row) return false;
			return revokeRow(row, refreshContext.getStore()?.revocationCause ?? "rotation");
		},
		revokeAll,
		listClients,
		revokeClient,
	};
}
