import assert from "node:assert";
import {
	writeIfCondition,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/storage-client";
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
// The lease outlasts the Gmail update Lambda and expires before an SQS redelivery.
const CLAIM_MS = 90_000;

const UpdateRow = z.object({
	userId: UserIdSchema,
	recordKey: z.string().startsWith(RECORD_PREFIX),
	receivedAtMessageId: z.string(),
	origin: GmailMessageOriginSchema,
	status: z.enum(["pending", "completed", "failed"]),
	requestedAt: z.string(),
	completedAt: dynamoField(z.string()),
	alreadyRead: z.boolean().optional(),
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
		return { ...base, status: "completed", completedAt: row.completedAt, alreadyRead: row.alreadyRead };
	}
	if (row.status === "failed") {
		assert(row.failedAt && row.failureReason, "a failed Gmail update records when and why it failed");
		return { ...base, status: "failed", failedAt: row.failedAt, failureReason: row.failureReason };
	}
	return { ...base, status: "pending" };
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
		claimPending: async ({ userId, origin, now }) => {
			const claimUntil = new Date(now.getTime() + CLAIM_MS).toISOString();
			const result = await writeIfCondition(() =>
				table.update({
					Key: updateKey({ userId, origin }),
					UpdateExpression: "SET claimUntil = :until",
					ConditionExpression: "#status = :pending AND (attribute_not_exists(claimUntil) OR claimUntil <= :now)",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":pending": "pending", ":until": claimUntil, ":now": now.toISOString() },
				}),
			);
			return result.kind === "written" ? claimUntil : undefined;
		},
		releaseClaim: async ({ userId, origin, claimUntil }) => {
			await writeIfCondition(() =>
				table.update({
					Key: updateKey({ userId, origin }),
					UpdateExpression: "REMOVE claimUntil",
					ConditionExpression: "claimUntil = :until",
					ExpressionAttributeValues: { ":until": claimUntil },
				}),
			);
		},
		recordPending: async ({ userId, receivedAtMessageId, origin, now }) => {
			await writeIfCondition(() =>
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
		markCompleted: async ({ userId, origin, now, alreadyRead = false }) => {
			await writeIfCondition(() =>
				table.update({
					Key: updateKey({ userId, origin }),
					UpdateExpression: "SET #status = :completed, completedAt = :now, alreadyRead = :alreadyRead REMOVE failedAt, failureReason, claimUntil",
					ConditionExpression: "attribute_exists(recordKey)",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":completed": "completed", ":now": now.toISOString(), ":alreadyRead": alreadyRead },
				}),
			);
		},
		markFailed: async ({ userId, origin, reason, now }) => {
			const written = (await writeIfCondition(() =>
				table.update({
					Key: updateKey({ userId, origin }),
					UpdateExpression: "SET #status = :failed, failedAt = :now, failureReason = :reason REMOVE claimUntil",
					ConditionExpression: "attribute_exists(recordKey) AND #status = :pending",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":failed": "failed", ":now": now.toISOString(), ":reason": reason, ":pending": "pending" },
				}),
			)).kind;
			return written === "written" ? "failed" : "unchanged";
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
		discardPending: async ({ userId, origin }) => {
			const written = (await writeIfCondition(() =>
				table.delete({
					Key: updateKey({ userId, origin }),
					ConditionExpression: "#status = :pending",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":pending": "pending" },
				}),
			)).kind;
			return written === "written" ? "discarded" : "unchanged";
		},
	};
}
