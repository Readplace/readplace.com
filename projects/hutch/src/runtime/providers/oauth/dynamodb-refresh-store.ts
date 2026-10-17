import assert from "node:assert";
import { createHmac, randomUUID } from "node:crypto";
import { isCurrentGrant, type RefreshAccount, type RefreshCommit, type RefreshCredential, type RefreshGrant, type RefreshStore } from "@packages/domain/oauth";
import { defineDynamoTable, dynamoField, type DynamoDBDocumentClient, TransactWriteCommand, TransactionCanceledException } from "@packages/hutch-storage-client";
import { z } from "zod";
import { CredentialHistory, initRefreshProof, OAuthGrantId, refreshContext } from "../../oauth-refresh/evidence";
import { authDiagnosticContext } from "../../auth-diagnostics/record";
import { attributeOAuthClient } from "../../auth-diagnostics/oauth-context";
import { OAuthTokenRow } from "./oauth-token-row";

const grantSchema = z.object({
	pk: z.string(), id: z.string(), userId: z.string(), clientId: z.string(), epoch: z.number(), generation: z.number(),
	accessToken: z.string(), refreshFingerprint: z.string(), keyThumbprint: z.string().optional(),
	state: z.enum(["active", "revoked"]), expiresAt: z.number(), validUntil: z.number(),
	latest: z.object({ operationId: z.string(), parentFingerprint: z.string(), bodyHash: z.string() }).optional(),
});
const accountSchema = z.object({
	pk: z.string(), epoch: z.number(), deletedAt: z.number().optional(),
	exemption: dynamoField(z.object({ atEpoch: z.number(), grantId: OAuthGrantId, grantEpoch: z.number() })),
});
type Operations = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]>;

export function initDynamoRefreshStore(deps: { client: DynamoDBDocumentClient; tableName: string; secret: string }) {
	const { client, tableName: TableName } = deps;
	const tokens = defineDynamoTable({ client, tableName: TableName, schema: OAuthTokenRow });
	const indexes = defineDynamoTable({ client, tableName: TableName, schema: z.object({ pk: z.string(), accessToken: z.string() }) });
	const histories = defineDynamoTable({ client, tableName: TableName, schema: CredentialHistory });
	const grants = defineDynamoTable({ client, tableName: TableName, schema: grantSchema });
	const accounts = defineDynamoTable({ client, tableName: TableName, schema: accountSchema });
	const { fingerprint } = initRefreshProof(deps.secret);
	const subjectReference = (value: string) => createHmac("sha256", deps.secret).update("auth-diagnostics:subject:").update(value).digest("hex");
	const ttl = (expiresAt: number) => Math.ceil(expiresAt / 1000) + 30 * 86400;
	const epochCondition = (userId: string, epoch: number) => ({ ConditionCheck: {
		TableName, Key: { pk: `oauth-account#${userId}` },
		ConditionExpression: epoch === 0 ? "attribute_not_exists(deletedAt) AND (attribute_not_exists(epoch) OR epoch = :epoch)" : "attribute_not_exists(deletedAt) AND epoch = :epoch",
		ExpressionAttributeValues: { ":epoch": epoch },
	} });
	async function readAccount(userId: string): Promise<RefreshAccount> {
		const row = await accounts.get({ pk: `oauth-account#${userId}` }, { consistentRead: true });
		return { epoch: row?.epoch ?? 0, exemption: row?.exemption };
	}
	async function readGrant(id: string): Promise<RefreshGrant | undefined> {
		const row = await grants.get({ pk: `grant#${id}` }, { consistentRead: true });
		if (!row) return undefined;
		attributeOAuthClient(row.clientId);
		const context = authDiagnosticContext.getStore();
		if (context) { context.grant_id = row.id; context.subject_ref = subjectReference(row.userId); }
		return { ...row, expiresAt: row.validUntil };
	}
	async function credential(row: z.infer<typeof OAuthTokenRow>): Promise<RefreshCredential> {
		let grantId = row.grantId;
		if (!grantId) {
			const { Attributes } = await histories.update({ Key: { pk: `credential#${fingerprint(row.refreshToken)}` },
				UpdateExpression: "SET grantId = if_not_exists(grantId, :grant), fingerprint = :fingerprint, credentialExpiresAt = if_not_exists(credentialExpiresAt, :expiry), expiresAt = if_not_exists(expiresAt, :ttl)",
				ExpressionAttributeValues: { ":grant": randomUUID(), ":fingerprint": fingerprint(row.refreshToken), ":expiry": row.refreshTokenExpiresAt * 1000, ":ttl": row.refreshTokenExpiresAt + 30 * 86400 }, ReturnValues: "ALL_NEW" });
			assert(Attributes); grantId = Attributes.grantId;
		}
		return { accessToken: row.accessToken, refreshToken: row.refreshToken, accessExpiresAt: row.accessTokenExpiresAt * 1000, refreshExpiresAt: row.refreshTokenExpiresAt * 1000,
			grantId, userId: row.userId, clientId: row.clientId, epoch: row.epoch ?? 0, generation: row.generation ?? 0, emailVerified: row.emailVerified === true, scope: row.scope, keyThumbprint: row.keyThumbprint, parentFingerprint: row.parentFingerprint };
	}
	function tokenItem(value: RefreshCredential) {
		return { pk: `token#${value.accessToken}`, accessToken: value.accessToken, refreshToken: value.refreshToken, accessTokenExpiresAt: value.accessExpiresAt / 1000,
			refreshTokenExpiresAt: value.refreshExpiresAt / 1000, expiresAt: Math.ceil(Math.max(value.accessExpiresAt, value.refreshExpiresAt) / 1000), grantId: value.grantId,
			userId: value.userId, clientId: value.clientId, epoch: value.epoch, generation: value.generation, emailVerified: value.emailVerified, scope: value.scope, keyThumbprint: value.keyThumbprint, parentFingerprint: value.parentFingerprint };
	}
	function newCredential(value: RefreshCredential): Operations {
		const token = { Put: { TableName, Item: tokenItem(value), ConditionExpression: "attribute_not_exists(pk)" } };
		if (!value.refreshToken) return [token];
		return [
			token,
			{ Put: { TableName, Item: { pk: `refresh#${value.refreshToken}`, accessToken: value.accessToken, expiresAt: Math.ceil(value.refreshExpiresAt / 1000) }, ConditionExpression: "attribute_not_exists(pk)" } },
			{ Put: { TableName, Item: { pk: `credential#${fingerprint(value.refreshToken)}`, grantId: value.grantId, fingerprint: fingerprint(value.refreshToken), credentialExpiresAt: value.refreshExpiresAt, expiresAt: ttl(value.refreshExpiresAt), parentFingerprint: value.parentFingerprint } } },
		];
	}
	function grantCondition(expected: RefreshGrant | undefined) {
		return expected ? {
			ConditionExpression: "generation = :generation AND #state = :state AND accessToken = :access AND epoch = :epoch",
			ExpressionAttributeNames: { "#state": "state" },
			ExpressionAttributeValues: { ":generation": expected.generation, ":state": expected.state, ":access": expected.accessToken, ":epoch": expected.epoch },
		} : { ConditionExpression: "attribute_not_exists(pk)" };
	}
	const store: RefreshStore = {
		readAccount, readGrant,
		async readCredential(accessToken) {
			const row = await tokens.get({ pk: `token#${accessToken}` }, { consistentRead: true });
			return row ? credential(row) : undefined;
		},
		async locate(token) {
			const index = await indexes.get({ pk: `refresh#${token}` }, { consistentRead: true });
			const row = await tokens.get({ pk: `token#${index?.accessToken ?? token}` }, { consistentRead: true });
			const found = row ? await credential(row) : undefined;
			if (found) attributeOAuthClient(found.clientId);
			const history = await histories.get({ pk: `credential#${fingerprint(row?.refreshToken ?? token)}` }, { consistentRead: true });
			const context = refreshContext.getStore();
			if (context) { context.credential = history; context.reason = history?.revocation?.cause ?? "unknown"; }
			const diagnostics = authDiagnosticContext.getStore();
			if (diagnostics) {
				diagnostics.grant_id = found?.grantId ?? history?.grantId;
				if (found) diagnostics.subject_ref = subjectReference(found.userId);
			}
			return { credential: found, history: history ? { grantId: history.grantId, fingerprint: history.fingerprint, expiresAt: history.credentialExpiresAt, revocation: history.revocation } : undefined };
		},
		async commit(input: RefreshCommit) {
			const operations: Operations = [epochCondition(input.grant.userId, input.accountEpoch)];
			const condition = grantCondition(input.expectedGrant);
			operations.push(input.cause === "recovery"
				? { ConditionCheck: { TableName, Key: { pk: `grant#${input.grant.id}` }, ...condition } }
				: { Put: { TableName, Item: { ...input.grant, pk: `grant#${input.grant.id}`, validUntil: input.grant.expiresAt, expiresAt: ttl(input.grant.expiresAt) }, ...condition } });
			const proofIndex = input.proof ? operations.length : -1;
			if (input.proof) operations.push({ Put: { TableName, Item: { pk: `oauth-proof#${fingerprint(`${input.proof.keyThumbprint}:${input.proof.id}`)}`, expiresAt: Math.ceil(input.proof.expiresAt / 1000) },
				ConditionExpression: "attribute_not_exists(pk) OR expiresAt <= :now", ExpressionAttributeValues: { ":now": Math.floor(input.now / 1000) } } });
			if (input.parent) {
				operations.push({ Delete: { TableName, Key: { pk: `token#${input.parent.accessToken}` }, ConditionExpression: "attribute_exists(pk)" } },
					{ Delete: { TableName, Key: { pk: `refresh#${input.parent.refreshToken}` } } },
					{ Update: { TableName, Key: { pk: `credential#${fingerprint(input.parent.refreshToken)}` },
						UpdateExpression: "SET grantId = :grant, fingerprint = :fingerprint, credentialExpiresAt = if_not_exists(credentialExpiresAt, :expiry), expiresAt = :ttl, revocation = :revocation",
						ExpressionAttributeValues: { ":grant": input.grant.id, ":fingerprint": fingerprint(input.parent.refreshToken), ":expiry": input.parent.refreshExpiresAt, ":ttl": ttl(Math.max(input.parent.refreshExpiresAt, input.grant.expiresAt)), ":revocation": { cause: input.cause, completedAt: input.now } } } });
			}
			if (input.child) operations.push(...newCredential(input.child));
			try { await client.send(new TransactWriteCommand({ TransactItems: operations })); }
			catch (error) {
				if (error instanceof TransactionCanceledException) {
					if (proofIndex >= 0 && error.CancellationReasons?.[proofIndex]?.Code === "ConditionalCheckFailed") return "proof_replayed";
					if (error.CancellationReasons?.some(reason => reason.Code === "ConditionalCheckFailed" || reason.Code === "TransactionConflict")) return "conflict";
				}
				throw error;
			}
			return "committed";
		},
	};
	return {
		store,
		async advanceEpoch(input: { userId: string; deleted: boolean }) {
			await accounts.update({ Key: { pk: `oauth-account#${input.userId}` },
				UpdateExpression: input.deleted ? "SET deletedAt = :deletedAt ADD epoch :one" : "ADD epoch :one",
				ExpressionAttributeValues: { ":one": 1, ...(input.deleted ? { ":deletedAt": Date.now() } : {}) },
			});
		},
		async saveInitial(value: RefreshCredential) {
			await client.send(new TransactWriteCommand({ TransactItems: [epochCondition(value.userId, value.epoch), ...newCredential(value)] }));
			const context = refreshContext.getStore();
			if (context && value.refreshToken) context.credential = { pk: `credential#${fingerprint(value.refreshToken)}`, grantId: OAuthGrantId.parse(value.grantId), fingerprint: fingerprint(value.refreshToken), credentialExpiresAt: value.refreshExpiresAt, expiresAt: ttl(value.refreshExpiresAt) };
		},
		async active(row: z.infer<typeof OAuthTokenRow>): Promise<boolean> {
			if (!isCurrentGrant({ account: await readAccount(row.userId), credential: { grantId: row.grantId, epoch: row.epoch ?? 0 } })) return false;
			const grant = row.grantId ? await readGrant(row.grantId) : undefined;
			if (row.keyThumbprint && !grant) throw new Error("Bound refresh grant is missing");
			return !grant || (grant.state === "active" && grant.generation === (row.generation ?? 0));
		},
	};
}
