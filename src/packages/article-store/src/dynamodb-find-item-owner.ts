import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { UserIdSchema } from "@packages/domain/user";
import { type DynamoDBDocumentClient, defineDynamoTable, dynamoField } from "@packages/hutch-storage-client";
import type { FindItemOwner } from "@packages/provider-contracts/article-store";
import { z } from "zod";

const ItemOwnerRow = z.object({ ownerUserId: dynamoField(UserIdSchema) });

export function initDynamoDbFindItemOwner(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { findItemOwner: FindItemOwner } {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: ItemOwnerRow });

	const findItemOwner: FindItemOwner = async (url) => {
		const row = await table.get(
			{ url: ArticleResourceUniqueId.parse(url).value },
			{ projection: ["ownerUserId"], consistentRead: true },
		);
		return row?.ownerUserId;
	};

	return { findItemOwner };
}
