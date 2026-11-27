import { ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { type DynamoDBDocumentClient, defineDynamoTable, forEachQueryPage } from "@packages/storage-client";
import { z } from "zod";
import { READLIST_DEFINITION_KEY_PREFIX } from "./user-readlist-partition";

const ReadlistDefinitionSlugRow = z.object({ queueSlug: ReadlistSlugSchema, createdAt: z.string() });

export async function listOwnedReadlistSlugs(params: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
	userId: UserId;
}): Promise<ReadlistSlug[]> {
	const definitions = defineDynamoTable({
		client: params.client,
		tableName: params.tableName,
		schema: ReadlistDefinitionSlugRow,
	});
	const rows: { slug: ReadlistSlug; createdAt: string }[] = [];
	await forEachQueryPage(
		definitions,
		{
			KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
			ExpressionAttributeNames: { "#url": "url" },
			ExpressionAttributeValues: {
				":userId": params.userId,
				":prefix": READLIST_DEFINITION_KEY_PREFIX,
			},
			ConsistentRead: true,
		},
		async (items) => {
			for (const item of items) rows.push({ slug: item.queueSlug, createdAt: item.createdAt });
		},
	);
	return rows
		.sort(
			(a, b) =>
				new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
				a.slug.localeCompare(b.slug),
		)
		.map((row) => row.slug);
}
