import type {
	CreateMediaUploadSession,
	FailMediaUpload,
	FindMediaUploadSession,
	MarkMediaUploadCommitted,
} from "@packages/domain";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	writeIfCondition,
} from "@packages/storage-client";
import { MediaKindNameSchema, UploadIdSchema } from "@packages/media-contracts";
import { z } from "zod";

export const MEDIA_UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60;

const SessionRow = z.object({
	uploadId: UploadIdSchema,
	userId: UserIdSchema,
	kind: dynamoField(MediaKindNameSchema),
	fileName: dynamoField(z.string()),
	byteLength: dynamoField(z.number().int().nonnegative()),
	saveAttemptId: SaveAttemptIdSchema,
	status: z.enum(["staged", "committed", "failed"]),
});

export function initDynamoDbMediaUploadSessions(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	createMediaUploadSession: CreateMediaUploadSession;
	findMediaUploadSession: FindMediaUploadSession;
	markMediaUploadCommitted: MarkMediaUploadCommitted;
	failMediaUpload: FailMediaUpload;
} {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: SessionRow });

	const transition = async <T extends string>(update: {
		uploadId: string;
		condition: string;
		values: Record<string, unknown>;
		to: T;
	}): Promise<T | "refused"> => {
		const outcome = await writeIfCondition(() =>
			table.update({
				Key: { uploadId: update.uploadId },
				UpdateExpression: "SET #status = :to",
				ConditionExpression: update.condition,
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: { ...update.values, ":to": update.to },
			}),
		);
		return outcome.kind === "written" ? update.to : "refused";
	};

	return {
		createMediaUploadSession: async (params) => {
			const session = { ...params, status: "staged" as const };
			await table.put({
				Item: {
					...session,
					expiresAt: Math.floor(deps.now().getTime() / 1000) + MEDIA_UPLOAD_SESSION_TTL_SECONDS,
				},
			});
			return session;
		},
		findMediaUploadSession: async ({ uploadId, userId }) => {
			const row = await table.get({ uploadId });
			return row?.userId === userId ? row : undefined;
		},
		markMediaUploadCommitted: async ({ uploadId, userId }) => {
			const outcome = await transition({
				uploadId,
				condition: "userId = :userId AND #status = :from",
				values: { ":userId": userId, ":from": "staged" },
				to: "committed",
			});
			return outcome === "refused" ? "not-staged" : outcome;
		},
		failMediaUpload: async ({ uploadId }) => {
			const outcome = await transition({
				uploadId,
				condition: "#status = :from",
				values: { ":from": "committed" },
				to: "failed",
			});
			return outcome === "refused" ? "not-committed" : outcome;
		},
	};
}
