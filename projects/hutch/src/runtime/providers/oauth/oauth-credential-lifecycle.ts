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
import type { RevokeAllUserOAuthTokens } from "@packages/provider-contracts/oauth";
import { z } from "zod";
import {
	CredentialFingerprint,
	CredentialHistory,
	OAuthGrantId,
	type RevocationCause,
	initRefreshProof,
	refreshContext,
} from "../../oauth-refresh/evidence";

export const OAuthTokenRow = z.object({
	pk: z.string(),
	accessToken: z.string(),
	refreshToken: z.string(),
	accessTokenExpiresAt: z.number(),
	refreshTokenExpiresAt: z.number(),
	clientId: z.string(),
	userId: z.string(),
	scope: z.array(z.string()).optional(),
	emailVerified: z.boolean().optional(),
	grantId: OAuthGrantId.optional(),
	parentFingerprint: CredentialFingerprint.optional(),
});
type OAuthTokenRow = z.infer<typeof OAuthTokenRow>;

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
	const proof = initRefreshProof(deps.secret);

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
		try {
			await client.send(new TransactWriteCommand({ TransactItems: [
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

	return {
		grant(user: User) {
			return {
				grantId: typeof user.grantId === "string" ? OAuthGrantId.parse(user.grantId) : OAuthGrantId.parse(randomUUID()),
				parentFingerprint: typeof user.parentFingerprint === "string" ? CredentialFingerprint.parse(user.parentFingerprint) : undefined,
			};
		},
		async save(row: OAuthTokenRow & { grantId: OAuthGrantId; expiresAt: number }) {
			await tokens.put({ Item: row });
			if (!row.refreshToken) return;
			const credential: CredentialHistory = {
				pk: `credential#${proof.fingerprint(row.refreshToken)}`,
				grantId: row.grantId,
				fingerprint: proof.fingerprint(row.refreshToken),
				credentialExpiresAt: row.refreshTokenExpiresAt * 1000,
				expiresAt: row.refreshTokenExpiresAt + 30 * 86400,
				parentFingerprint: row.parentFingerprint,
			};
			await history.put({ Item: credential });
			await refreshIndex.put({ Item: { pk: `refresh#${row.refreshToken}`, accessToken: row.accessToken, expiresAt: row.refreshTokenExpiresAt } });
			const context = refreshContext.getStore();
			if (context) context.credential = credential;
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
	};
}
