import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	DeleteDigestItem,
	DigestQueueItem,
	EnqueueDigestItem,
	ListDigestItemsByUser,
	ScanPendingDigestUsers,
} from "@packages/provider-contracts/digest-queue";

const DigestQueueRow = z.object({
	userId: UserIdSchema,
	url: z.string(),
	originalUrl: z.string(),
	enqueuedAt: z.string(),
	/* Epoch-seconds TTL. A safety purge only: rows are normally drained on send
	 * well within the window. `dynamoField` so a legacy row without it still
	 * parses. */
	expiresAt: dynamoField(z.number()),
});

const MS_PER_SECOND = 1000;

export function initDynamoDbDigestQueue(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	enqueueDigestItem: EnqueueDigestItem;
	listDigestItemsByUser: ListDigestItemsByUser;
	deleteDigestItem: DeleteDigestItem;
	scanPendingDigestUsers: ScanPendingDigestUsers;
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

	const listDigestItemsByUser: ListDigestItemsByUser = async (userId) => {
		const items: DigestQueueItem[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const { items: rows, lastEvaluatedKey } = await table.query({
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": userId },
				ExclusiveStartKey: exclusiveStartKey,
			});
			for (const row of rows) {
				items.push({
					userId: row.userId,
					url: row.url,
					originalUrl: row.originalUrl,
					enqueuedAt: row.enqueuedAt,
				});
			}
			exclusiveStartKey = lastEvaluatedKey;
		} while (exclusiveStartKey);
		return items;
	};

	const deleteDigestItem: DeleteDigestItem = async ({ userId, url }) => {
		await table.delete({ Key: { userId, url } });
	};

	const scanPendingDigestUsers: ScanPendingDigestUsers = async () => {
		const users = new Set<UserId>();
		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const { items, lastEvaluatedKey } = await table.scan({
				ExclusiveStartKey: exclusiveStartKey,
			});
			for (const item of items) {
				users.add(item.userId);
			}
			exclusiveStartKey = lastEvaluatedKey;
		} while (exclusiveStartKey);
		return [...users];
	};

	return { enqueueDigestItem, listDigestItemsByUser, deleteDigestItem, scanPendingDigestUsers };
}
