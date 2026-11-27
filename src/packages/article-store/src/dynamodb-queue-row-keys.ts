import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	type DynamoDBDocumentClient,
	batchGetFromTable,
} from "@packages/storage-client";
import type { FindQueueRowKeys } from "@packages/provider-contracts/article-store";
import { z } from "zod";
import { listOwnedReadlistSlugs } from "./readlist-definition-rows";
import { readlistPartitionValue } from "./user-readlist-partition";

const DYNAMODB_SORT_KEY_MAX_BYTES = 1024;

const QueueRowKeyRow = z.object({ userId: z.string(), url: z.string() });

export function initDynamoDbFindQueueRowKeys(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	userArticlesTableName: string;
}): FindQueueRowKeys {
	return async ({ userId, urls }) => {
		const keys = [...new Set(urls.map((url) => ArticleResourceUniqueId.parse(url).value))].filter(
			(key) => Buffer.byteLength(key, "utf8") <= DYNAMODB_SORT_KEY_MAX_BYTES,
		);
		if (keys.length === 0) return [];
		const readlists = await listOwnedReadlistSlugs({ client: deps.client, tableName: deps.userArticlesTableName, userId });
		const partitions = [userId, ...readlists.map((readlist) => readlistPartitionValue({ userId, readlist }))];
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
