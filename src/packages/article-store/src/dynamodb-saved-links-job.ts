import {
	type CountedNewsletterLinks,
	type SavedLinksJob,
	SavedLinksJobActionSchema,
	SavedLinksJobCountsSchema,
	SavedLinksJobIdSchema,
	SavedLinksJobStateSchema,
} from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	FindSavedLinksJob,
	FinishSavedLinksJob,
	RecordCountedNewsletterLinks,
	RecordSavedLinksJobProgress,
	RequestSavedLinksJob,
	WithdrawSavedLinksJob,
} from "@packages/provider-contracts/article-store";
import { type DynamoDBDocumentClient, defineDynamoTable, dynamoField, writeIfCondition } from "@packages/storage-client";
import { z } from "zod";
import { savedLinksJobKey } from "./user-readlist-partition";

const CountedItem = z.object({
	cutoff: z.string(),
	issues: z.number().int().nonnegative(),
	summary: z.object({
		selected: z.number().int().nonnegative(),
		bySender: z.array(z.object({ senderEmail: z.string(), count: z.number().int().nonnegative() })),
		skipped: z.strictObject({
			read: z.number().int().nonnegative(),
			highlighted: z.number().int().nonnegative(),
			changed: z.number().int().nonnegative(),
			unreadable: z.number().int().nonnegative(),
		}),
		earliestEmailSave: dynamoField(z.string()),
	}),
	held: z.object({
		bySender: z.array(z.object({ senderEmail: z.string(), count: z.number().int().nonnegative() })),
		unrestorable: z.array(z.string()),
	}),
});

function toCounted(item: z.infer<typeof CountedItem>): CountedNewsletterLinks {
	const { earliestEmailSave, ...summary } = item.summary;
	return {
		cutoff: new Date(item.cutoff),
		issues: item.issues,
		summary: { ...summary, earliestEmailSave: earliestEmailSave === undefined ? undefined : new Date(earliestEmailSave) },
		held: item.held,
	};
}

function toCountedItem(counted: CountedNewsletterLinks) {
	const { earliestEmailSave, ...summary } = counted.summary;
	return {
		cutoff: counted.cutoff.toISOString(),
		issues: counted.issues,
		summary: { ...summary, ...(earliestEmailSave === undefined ? {} : { earliestEmailSave: earliestEmailSave.toISOString() }) },
		held: counted.held,
	};
}

const SavedLinksJobItem = z.object({
	jobId: SavedLinksJobIdSchema,
	action: SavedLinksJobActionSchema,
	state: SavedLinksJobStateSchema,
	requestedAt: z.string(),
	counts: SavedLinksJobCountsSchema,
	finishedAt: dynamoField(z.string()),
	counted: dynamoField(z.unknown()),
});

function toSavedLinksJob(item: z.infer<typeof SavedLinksJobItem>): SavedLinksJob {
	const counted = CountedItem.safeParse(item.counted);
	return {
		jobId: item.jobId,
		action: item.action,
		state: item.state,
		requestedAt: new Date(item.requestedAt),
		counts: item.counts,
		...(item.finishedAt === undefined ? {} : { finishedAt: new Date(item.finishedAt) }),
		...(counted.success ? { counted: toCounted(counted.data) } : {}),
	};
}

export function initDynamoDbSavedLinksJob(deps: { client: DynamoDBDocumentClient; userArticlesTableName: string }): {
	requestSavedLinksJob: RequestSavedLinksJob;
	recordSavedLinksJobProgress: RecordSavedLinksJobProgress;
	recordCountedNewsletterLinks: RecordCountedNewsletterLinks;
	finishSavedLinksJob: FinishSavedLinksJob;
	findSavedLinksJob: FindSavedLinksJob;
	withdrawSavedLinksJob: WithdrawSavedLinksJob;
} {
	const jobs = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: SavedLinksJobItem,
	});

	const keyOf = (userId: UserId) => ({ userId, url: savedLinksJobKey(userId) });

	const findSavedLinksJob: FindSavedLinksJob = async ({ userId }) => {
		const item = await jobs.get(keyOf(userId), { consistentRead: true });
		return item === undefined ? undefined : toSavedLinksJob(item);
	};

	const requestSavedLinksJob: RequestSavedLinksJob = async ({ userId, jobId, action, requestedAt }) => {
		const outcome = await writeIfCondition(() =>
			jobs.put({
				Item: { ...keyOf(userId), jobId, action, state: "requested", requestedAt: requestedAt.toISOString(), counts: {} },
				ConditionExpression: "attribute_not_exists(#url) OR #state IN (:completed, :failed) OR #action = :count",
				ExpressionAttributeNames: { "#url": "url", "#state": "state", "#action": "action" },
				ExpressionAttributeValues: { ":completed": "completed", ":failed": "failed", ":count": "count" },
			}),
		);
		if (outcome.kind === "written") return { outcome: "claimed" };
		const job = await findSavedLinksJob({ userId });
		return job === undefined ? requestSavedLinksJob({ userId, jobId, action, requestedAt }) : { outcome: "busy", job };
	};

	const recordSavedLinksJobProgress: RecordSavedLinksJobProgress = async ({ userId, jobId, counts }) => {
		const outcome = await writeIfCondition(() =>
			jobs.update({
				Key: keyOf(userId),
				UpdateExpression: "SET #state = :running, counts = :counts REMOVE finishedAt",
				ConditionExpression: "jobId = :jobId AND #state <> :completed",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: { ":running": "running", ":completed": "completed", ":counts": counts, ":jobId": jobId },
			}),
		);
		return outcome.kind === "written" ? { outcome: "recorded" } : { outcome: "stale" };
	};

	const recordCountedNewsletterLinks: RecordCountedNewsletterLinks = async ({ userId, jobId, counted }) => {
		const outcome = await writeIfCondition(() =>
			jobs.update({
				Key: keyOf(userId),
				UpdateExpression: "SET #counted = :counted",
				ConditionExpression: "jobId = :jobId AND #state <> :completed",
				ExpressionAttributeNames: { "#state": "state", "#counted": "counted" },
				ExpressionAttributeValues: { ":completed": "completed", ":counted": toCountedItem(counted), ":jobId": jobId },
			}),
		);
		return outcome.kind === "written" ? { outcome: "recorded" } : { outcome: "stale" };
	};

	const finishSavedLinksJob: FinishSavedLinksJob = async ({ userId, jobId, state, counts, finishedAt }) => {
		const outcome = await writeIfCondition(() =>
			jobs.update({
				Key: keyOf(userId),
				UpdateExpression: "SET #state = :state, counts = :counts, finishedAt = :finishedAt",
				ConditionExpression: "jobId = :jobId AND #state <> :completed",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: {
					":completed": "completed",
					":state": state,
					":counts": counts,
					":finishedAt": finishedAt.toISOString(),
					":jobId": jobId,
				},
			}),
		);
		return outcome.kind === "written" ? { outcome: "recorded" } : { outcome: "stale" };
	};

	const withdrawSavedLinksJob: WithdrawSavedLinksJob = async ({ userId, jobId }) => {
		const outcome = await writeIfCondition(() =>
			jobs.delete({
				Key: keyOf(userId),
				ConditionExpression: "jobId = :jobId AND #state = :requested",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: { ":jobId": jobId, ":requested": "requested" },
			}),
		);
		return outcome.kind === "written" ? { outcome: "withdrawn" } : { outcome: "stale" };
	};

	return {
		requestSavedLinksJob,
		recordSavedLinksJobProgress,
		recordCountedNewsletterLinks,
		finishSavedLinksJob,
		findSavedLinksJob,
		withdrawSavedLinksJob,
	};
}
