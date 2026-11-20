import {
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
	RecordSavedLinksJobProgress,
	RequestSavedLinksJob,
	WithdrawSavedLinksJob,
} from "@packages/provider-contracts/article-store";
import { type DynamoDBDocumentClient, defineDynamoTable, dynamoField, writeIfCondition } from "@packages/storage-client";
import { z } from "zod";
import { savedLinksJobKey } from "./user-readlist-partition";

const SavedLinksJobItem = z.object({
	jobId: SavedLinksJobIdSchema,
	action: SavedLinksJobActionSchema,
	state: SavedLinksJobStateSchema,
	requestedAt: z.string(),
	counts: SavedLinksJobCountsSchema,
	finishedAt: dynamoField(z.string()),
});

function toSavedLinksJob(item: z.infer<typeof SavedLinksJobItem>): SavedLinksJob {
	return {
		jobId: item.jobId,
		action: item.action,
		state: item.state,
		requestedAt: new Date(item.requestedAt),
		counts: item.counts,
		...(item.finishedAt === undefined ? {} : { finishedAt: new Date(item.finishedAt) }),
	};
}

export function initDynamoDbSavedLinksJob(deps: { client: DynamoDBDocumentClient; userArticlesTableName: string }): {
	requestSavedLinksJob: RequestSavedLinksJob;
	recordSavedLinksJobProgress: RecordSavedLinksJobProgress;
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
				ConditionExpression: "attribute_not_exists(#url) OR #state IN (:completed, :failed)",
				ExpressionAttributeNames: { "#url": "url", "#state": "state" },
				ExpressionAttributeValues: { ":completed": "completed", ":failed": "failed" },
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

	return { requestSavedLinksJob, recordSavedLinksJobProgress, finishSavedLinksJob, findSavedLinksJob, withdrawSavedLinksJob };
}
