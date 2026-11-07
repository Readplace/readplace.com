import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { EventInstantSchema, toEventInstant } from "@packages/domain/event-envelope";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { FindReadlistRemoval } from "@packages/provider-contracts/article-store";
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

export function initFindReadlistRemoval(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): FindReadlistRemoval {
	return async ({ userId, readlist, url }) => {
		const attribute = readlistRemovedAtAttribute(readlist);
		const markers = defineDynamoTable({
			client: deps.client,
			tableName: deps.userArticlesTableName,
			schema: z.object({ [attribute]: EventInstantSchema.optional() }),
		});
		const row = await markers.get(
			{ userId, url: ArticleResourceUniqueId.parse(url).value },
			{ consistentRead: true },
		);
		return row?.[attribute];
	};
}
