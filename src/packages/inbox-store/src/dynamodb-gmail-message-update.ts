import assert from "node:assert";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	type GmailAccountEmail,
	gmailAccountKey,
	type GmailMessageOrigin,
	GmailMessageOriginSchema,
	type GmailMessageUpdate,
	GmailMessageUpdateFailureReasonSchema,
	type GmailMessageUpdateStore,
	gmailMessageOriginKey,
} from "@packages/domain/gmail";
import { type UserId, UserIdSchema } from "@packages/domain/user";

const RECORD_PREFIX = "GMAIL_UPDATE#";

const UpdateRow = z.object({
	userId: UserIdSchema,
	recordKey: z.string().startsWith(RECORD_PREFIX),
	receivedAtMessageId: z.string(),
	origin: GmailMessageOriginSchema,
	status: z.enum(["pending", "completed", "failed"]),
	requestedAt: z.string(),
	completedAt: dynamoField(z.string()),
	failedAt: dynamoField(z.string()),
	failureReason: dynamoField(GmailMessageUpdateFailureReasonSchema),
});

function accountPrefix(accountEmail: GmailAccountEmail): string {
	return `${RECORD_PREFIX}${gmailAccountKey(accountEmail)}#`;
}

function updateKey(input: { userId: UserId; origin: GmailMessageOrigin }): { userId: UserId; recordKey: string } {
	return { userId: input.userId, recordKey: `${accountPrefix(input.origin.accountEmail)}${gmailMessageOriginKey(input.origin)}` };
}

function toUpdate(row: z.infer<typeof UpdateRow>): GmailMessageUpdate {
	const base = { userId: row.userId, receivedAtMessageId: row.receivedAtMessageId, origin: row.origin, requestedAt: row.requestedAt };
	if (row.status === "completed") {
		assert(row.completedAt, "a completed Gmail update records when it completed");
		return { ...base, status: "completed", completedAt: row.completedAt };
	}
	if (row.status === "failed") {
		assert(row.failedAt && row.failureReason, "a failed Gmail update records when and why it failed");
		return { ...base, status: "failed", failedAt: row.failedAt, failureReason: row.failureReason };
	}
	return { ...base, status: "pending" };
}

async function unlessConditionFails(write: () => Promise<unknown>): Promise<void> {
	try {
		await write();
	} catch (error) {
		if (!(error instanceof ConditionalCheckFailedException)) throw error;
	}
}

export function initDynamoDbGmailMessageUpdate(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): GmailMessageUpdateStore {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: UpdateRow });

	const find: GmailMessageUpdateStore["find"] = async (input) => {
		const row = await table.get(updateKey(input), { consistentRead: true });
		return row === undefined ? undefined : toUpdate(row);
	};

	return {
		recordPending: async ({ userId, receivedAtMessageId, origin, now }) => {
			await unlessConditionFails(() =>
				table.put({
					Item: {
						...updateKey({ userId, origin }),
						receivedAtMessageId,
						origin,
						status: "pending",
						requestedAt: now.toISOString(),
					},
					ConditionExpression: "attribute_not_exists(recordKey)",
				}),
			);
			const recorded = await find({ userId, origin });
			assert(recorded, "a Gmail update is stored once its conditional put settles");
			return recorded;
		},
		find,
		markCompleted: async ({ userId, origin, now }) => {
			await table.update({
				Key: updateKey({ userId, origin }),
				UpdateExpression: "SET #status = :completed, completedAt = :now REMOVE failedAt, failureReason",
				ConditionExpression: "attribute_exists(recordKey)",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: { ":completed": "completed", ":now": now.toISOString() },
			});
		},
		markFailed: async ({ userId, origin, reason, now }) => {
			await unlessConditionFails(() =>
				table.update({
					Key: updateKey({ userId, origin }),
					UpdateExpression: "SET #status = :failed, failedAt = :now, failureReason = :reason",
					ConditionExpression: "attribute_exists(recordKey) AND #status <> :completed",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":failed": "failed", ":now": now.toISOString(), ":reason": reason, ":completed": "completed" },
				}),
			);
		},
		listPendingByAccount: async ({ userId, accountEmail }) => {
			const pending: GmailMessageUpdate[] = [];
			await forEachQueryPage(
				table,
				{
					KeyConditionExpression: "userId = :uid AND begins_with(recordKey, :prefix)",
					FilterExpression: "#status = :pending",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":uid": userId, ":prefix": accountPrefix(accountEmail), ":pending": "pending" },
					ConsistentRead: true,
				},
				async (rows) => {
					for (const row of rows) pending.push(toUpdate(row));
				},
			);
			return pending;
		},
	};
}
