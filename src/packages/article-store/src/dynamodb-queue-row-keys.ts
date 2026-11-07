import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/storage-client";
import type { FindQueueRowKeys } from "@packages/provider-contracts/article-store";
import { z } from "zod";
import { READLIST_DEFINITION_KEY_PREFIX, readlistPartitionValue } from "./user-readlist-partition";

const DYNAMODB_SORT_KEY_MAX_BYTES = 1024;

const QueueRowKeyRow = z.object({ userId: z.string(), url: z.string() });

const ReadlistDefinitionRow = z.object({ queueSlug: ReadlistSlugSchema });

export function initDynamoDbFindQueueRowKeys(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	userArticlesTableName: string;
}): FindQueueRowKeys {
	const readlistDefinitions = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: ReadlistDefinitionRow,
	});

	return async ({ userId, urls }) => {
		const keys = [...new Set(urls.map((url) => ArticleResourceUniqueId.parse(url).value))].filter(
			(key) => Buffer.byteLength(key, "utf8") <= DYNAMODB_SORT_KEY_MAX_BYTES,
		);
		if (keys.length === 0) return [];
		const partitions: string[] = [userId];
		await forEachQueryPage(
			readlistDefinitions,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":userId": userId, ":prefix": READLIST_DEFINITION_KEY_PREFIX },
				ConsistentRead: true,
			},
			async (items) => {
				for (const item of items) partitions.push(readlistPartitionValue({ userId, readlist: item.queueSlug }));
			},
		);
		return batchGetFromTable({
			client: deps.client,
			tableName: deps.userArticlesTableName,
			schema: QueueRowKeyRow,
			keys: partitions.flatMap((partition) => keys.map((url) => ({ userId: partition, url }))),
			projection: ["userId", "url"],
			consistentRead: true,
		});
	};
}
