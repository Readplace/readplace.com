import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	DeleteDigestByUser,
	EnqueueDigestItem,
} from "@packages/provider-contracts/digest-queue";

const DigestQueueRow = z.object({
	userId: UserIdSchema,
	url: z.string(),
	originalUrl: z.string(),
	enqueuedAt: z.string(),
	/* Epoch-seconds TTL. `dynamoField` so a legacy row without it still
	 * parses. */
	expiresAt: dynamoField(z.number()),
});

const MS_PER_SECOND = 1000;

export function initDynamoDbDigestQueue(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	enqueueDigestItem: EnqueueDigestItem;
	deleteDigestByUser: DeleteDigestByUser;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: DigestQueueRow,
	});

	const enqueueDigestItem: EnqueueDigestItem = async ({ userId, url, enqueuedAt, retentionMs }) => {
		const canonical = ArticleResourceUniqueId.parse(url);
		const retentionSeconds = Math.floor(retentionMs / MS_PER_SECOND);
		const expiresAt = Math.floor(new Date(enqueuedAt).getTime() / MS_PER_SECOND) + retentionSeconds;
		await table.put({
			Item: {
				userId,
				url: canonical.value,
				originalUrl: url,
				enqueuedAt,
				expiresAt,
			},
		});
	};

	const deleteDigestByUser: DeleteDigestByUser = async (userId) => {
		await forEachQueryPage(
			table,
			{
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": userId },
			},
			async (rows) => {
				await Promise.all(
					rows.map((row) => table.delete({ Key: { userId: row.userId, url: row.url } })),
				);
			},
		);
	};

	return { enqueueDigestItem, deleteDigestByUser };
}
