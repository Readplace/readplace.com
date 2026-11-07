import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { toEventInstant } from "@packages/domain/event-envelope";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { type DynamoDBDocumentClient, defineDynamoTable, writeIfCondition } from "@packages/storage-client";
import { z } from "zod";

export function readlistRemovedAtAttribute(readlist: ReadlistSlug): string {
	return `readlistRemovedAt#${readlist}`;
}

export type RecordReadlistRemoval = (params: { userId: UserId; readlist: ReadlistSlug; url: string }) => Promise<void>;

export function initRecordReadlistRemoval(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
	now: () => Date;
}): RecordReadlistRemoval {
	const allRows = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: z.object({ userId: z.string(), url: z.string() }),
	});
	return async ({ userId, readlist, url }) => {
		await writeIfCondition(() =>
			allRows.update({
				Key: { userId, url: ArticleResourceUniqueId.parse(url).value },
				UpdateExpression: "SET #removedAt = :removedAt",
				ConditionExpression: "attribute_exists(savedAt)",
				ExpressionAttributeNames: { "#removedAt": readlistRemovedAtAttribute(readlist) },
				ExpressionAttributeValues: { ":removedAt": toEventInstant(deps.now()) },
			}),
		);
	};
}
