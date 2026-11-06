import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ItemMediaSchema, type SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	writeIfCondition,
} from "@packages/storage-client";
import { EnclosureSchema } from "@packages/media-contracts";
import type { SetArticleEnclosure } from "@packages/provider-contracts/article-store";
import { z } from "zod";

const PrivateItemMediaRow = z.object({
	ownerUserId: dynamoField(UserIdSchema),
	media: dynamoField(ItemMediaSchema),
	enclosure: dynamoField(EnclosureSchema),
	purgedAt: dynamoField(z.string()),
});

export function initDynamoDbPrivateItemMedia(deps: { client: DynamoDBDocumentClient; tableName: string }): {
	setArticleEnclosure: SetArticleEnclosure;
	findArticleMedia: (params: { url: string }) => Promise<Pick<SavedArticle, "media" | "enclosure"> | undefined>;
} {
	const articles = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: PrivateItemMediaRow });

	const setArticleEnclosure: SetArticleEnclosure = async (params) => {
		const outcome = await writeIfCondition(() =>
			articles.update({
				Key: { url: ArticleResourceUniqueId.parse(params.url).value },
				UpdateExpression: "SET enclosure = :enclosure",
				ConditionExpression: "attribute_exists(ownerUserId) AND attribute_not_exists(purgedAt)",
				ExpressionAttributeValues: { ":enclosure": params.enclosure },
			}),
		);
		return outcome.kind === "written" ? "recorded" : "not-found";
	};

	const findArticleMedia = async (params: { url: string }) => {
		const row = await articles.get(
			{ url: ArticleResourceUniqueId.parse(params.url).value },
			{ projection: ["media", "enclosure", "purgedAt"], consistentRead: true },
		);
		if (row === undefined || row.purgedAt !== undefined) return undefined;
		return { media: row.media, enclosure: row.enclosure };
	};

	return { setArticleEnclosure, findArticleMedia };
}
