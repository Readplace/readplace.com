import assert from "node:assert";
import {
	writeIfCondition,
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/storage-client";
import { z } from "zod";
import {
	EmailIdentityKeySchema,
	type EmailIdentityClaim,
	type EmailIdentityStore,
	IngestionAttemptSchema,
	ingestionAttemptKey,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";

const EmailIdentityRow = z.object({
	identityKey: EmailIdentityKeySchema,
	userId: UserIdSchema,
	receivedAtMessageId: z.string(),
	attempt: IngestionAttemptSchema,
	attemptKey: z.string(),
	claimedAt: z.string(),
});

const EmailIdentityKeyRow = z.object({
	identityKey: EmailIdentityKeySchema,
});

const EmailIdentityEmailRow = z.object({
	identityKey: EmailIdentityKeySchema,
	receivedAtMessageId: z.string(),
});

function toClaim(row: z.infer<typeof EmailIdentityRow>): EmailIdentityClaim {
	return {
		key: row.identityKey,
		userId: row.userId,
		receivedAtMessageId: row.receivedAtMessageId,
		attempt: row.attempt,
		claimedAt: row.claimedAt,
	};
}

export function initDynamoDbEmailIdentity(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): EmailIdentityStore {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: EmailIdentityRow });
	const keys = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: EmailIdentityKeyRow });

	const find: EmailIdentityStore["find"] = async (key) => {
		const row = await table.get({ identityKey: key }, { consistentRead: true });
		return row === undefined ? undefined : toClaim(row);
	};

	return {
		find,
		claim: async ({ now, ...input }) => {
			const claim: EmailIdentityClaim = { ...input, claimedAt: now.toISOString() };
			const outcome = await writeIfCondition(() => table.put({
				Item: {
					identityKey: claim.key,
					userId: claim.userId,
					receivedAtMessageId: claim.receivedAtMessageId,
					attempt: claim.attempt,
					attemptKey: ingestionAttemptKey(claim.attempt),
					claimedAt: claim.claimedAt,
				},
				ConditionExpression: "attribute_not_exists(identityKey)",
			}));
			if (outcome.kind === "written") return { status: "claimed", claim };
			const existing = await find(input.key);
			assert(existing, "a failed identity claim must leave the winning claim in place");
			const sameAttempt = ingestionAttemptKey(existing.attempt) === ingestionAttemptKey(input.attempt);
			return { status: sameAttempt ? "same-attempt" : "claimed-elsewhere", claim: existing };
		},
		takeOver: async ({ previous, attempt, now }) => {
			const outcome = await writeIfCondition(() => table.update({
				Key: { identityKey: previous.key },
				UpdateExpression: "SET #attempt = :attempt, attemptKey = :attemptKey, claimedAt = :now",
				ConditionExpression: "attemptKey = :previousAttemptKey",
				ExpressionAttributeNames: { "#attempt": "attempt" },
				ExpressionAttributeValues: {
					":attempt": attempt,
					":attemptKey": ingestionAttemptKey(attempt),
					":now": now.toISOString(),
					":previousAttemptKey": ingestionAttemptKey(previous.attempt),
				},
			}));
			if (outcome.kind === "condition-failed") return false;
			return true;
		},
		deleteAllByUserId: async (userId) => {
			await forEachQueryPage(
				keys,
				{
					IndexName: "userId-index",
					KeyConditionExpression: "userId = :uid",
					ExpressionAttributeValues: { ":uid": userId },
				},
				async (rows) => {
					await Promise.all(rows.map((row) => keys.delete({ Key: { identityKey: row.identityKey } })));
				},
			);
		},
		deleteByEmails: async ({ userId, receivedAtMessageIds }) => {
			if (receivedAtMessageIds.length === 0) return;
			await forEachQueryPage(
				keys,
				{
					IndexName: "userId-index",
					KeyConditionExpression: "userId = :uid",
					ExpressionAttributeValues: { ":uid": userId },
				},
				async (rows) => {
					const claims = await batchGetFromTable({
						client: deps.client,
						tableName: deps.tableName,
						schema: EmailIdentityEmailRow,
						keys: rows.map((row) => ({ identityKey: row.identityKey })),
						projection: ["identityKey", "receivedAtMessageId"],
					});
					await Promise.all(
						claims
							.filter((claim) => receivedAtMessageIds.includes(claim.receivedAtMessageId))
							.map((claim) => keys.delete({ Key: { identityKey: claim.identityKey } })),
					);
				},
			);
		},
	};
}
