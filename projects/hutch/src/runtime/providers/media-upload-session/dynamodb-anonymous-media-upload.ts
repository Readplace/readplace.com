import type {
	AnyMediaUploadSession,
	ClaimMediaUpload,
	CreateAnyMediaUploadSession,
	FindMediaUploadByCapability,
	MarkMediaUploadInspecting,
	RecordMediaInspection,
} from "@packages/domain";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	writeIfCondition,
} from "@packages/storage-client";
import {
	MediaFailureReasonSchema,
	MediaInspectionFactsSchema,
	MediaKindNameSchema,
	UploadIdSchema,
} from "@packages/media-contracts";
import { z } from "zod";
import { isAccessibleBy } from "../import-session/import-session-ownership";
import { MEDIA_UPLOAD_SESSION_TTL_SECONDS } from "./dynamodb-media-upload-sessions";

const AnyRow = z.object({
	uploadId: UploadIdSchema,
	userId: dynamoField(UserIdSchema),
	kind: MediaKindNameSchema,
	fileName: z.string(),
	byteLength: dynamoField(z.number().int().nonnegative()),
	saveAttemptId: SaveAttemptIdSchema,
	status: z.enum(["staged", "committed", "failed", "inspecting", "ready", "rejected"]),
	etag: dynamoField(z.string()),
	facts: dynamoField(MediaInspectionFactsSchema),
	reason: dynamoField(MediaFailureReasonSchema),
	notice: dynamoField(z.string()),
});

const SignedInSession = AnyRow.extend({
	userId: UserIdSchema,
	status: z.enum(["staged", "committed", "failed"]),
});

const AnonymousSession = AnyRow.omit({ userId: true }).extend({
	status: z.enum(["staged", "inspecting", "ready", "rejected"]),
});

const ClaimedSession = SignedInSession.extend({ etag: z.string() });

function toSession(row: z.infer<typeof AnyRow>): AnyMediaUploadSession {
	return row.userId === undefined ? AnonymousSession.parse(row) : SignedInSession.parse(row);
}

export function initDynamoDbAnonymousMediaUpload(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	createAnyMediaUploadSession: CreateAnyMediaUploadSession;
	markMediaUploadInspecting: MarkMediaUploadInspecting;
	recordMediaInspection: RecordMediaInspection;
	claimMediaUpload: ClaimMediaUpload;
	findMediaUploadByCapability: FindMediaUploadByCapability;
} {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: AnyRow });

	const update = async (input: Parameters<typeof table.update>[0]) => {
		const outcome = await writeIfCondition(() => table.update(input));
		return outcome.kind === "written" ? outcome.result : ("refused" as const);
	};

	return {
		createAnyMediaUploadSession: async ({ userId, ...params }) => {
			const session: AnyMediaUploadSession =
				userId === undefined ? { ...params, status: "staged" } : { ...params, userId, status: "staged" };
			await table.put({
				Item: {
					...session,
					expiresAt: Math.floor(deps.now().getTime() / 1000) + MEDIA_UPLOAD_SESSION_TTL_SECONDS,
				},
				ConditionExpression: "attribute_not_exists(uploadId)",
			});
			return session;
		},
		markMediaUploadInspecting: async ({ uploadId, etag }) => {
			const outcome = await update({
				Key: { uploadId },
				UpdateExpression: "SET #status = :inspecting, etag = :etag",
				ConditionExpression: "#status = :staged AND attribute_not_exists(userId)",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: { ":inspecting": "inspecting", ":etag": etag, ":staged": "staged" },
			});
			return outcome === "refused" ? "not-staged" : "inspecting";
		},
		recordMediaInspection: async ({ uploadId, inspection }) => {
			const to = inspection.verdict === "inspected" ? "ready" : "rejected";
			const outcome = await update({
				Key: { uploadId },
				...(inspection.verdict === "inspected"
					? {
							UpdateExpression: "SET #status = :to, facts = :facts",
							ExpressionAttributeValues: { ":to": to, ":facts": inspection.facts, ":inspecting": "inspecting" },
						}
					: {
							UpdateExpression: "SET #status = :to, reason = :reason, notice = :notice",
							ExpressionAttributeValues: {
								":to": to,
								":reason": inspection.reason,
								":notice": inspection.notice,
								":inspecting": "inspecting",
							},
						}),
				ConditionExpression: "#status = :inspecting",
				ExpressionAttributeNames: { "#status": "status" },
			});
			return outcome === "refused" ? "not-inspecting" : to;
		},
		claimMediaUpload: async ({ uploadId, userId }) => {
			const outcome = await update({
				Key: { uploadId },
				UpdateExpression: "SET #status = :staged, userId = :uid",
				ConditionExpression:
					"(#status = :ready AND attribute_not_exists(userId)) OR (#status = :staged AND userId = :uid AND attribute_exists(etag))",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: { ":staged": "staged", ":ready": "ready", ":uid": userId },
				ReturnValues: "ALL_NEW",
			});
			return outcome === "refused" ? "not-claimable" : ClaimedSession.parse(outcome.Attributes);
		},
		findMediaUploadByCapability: async ({ uploadId, userId }) => {
			const row = await table.get({ uploadId });
			if (row === undefined) return undefined;
			return isAccessibleBy({ ownerId: row.userId, callerId: userId }) ? toSession(row) : undefined;
		},
	};
}
