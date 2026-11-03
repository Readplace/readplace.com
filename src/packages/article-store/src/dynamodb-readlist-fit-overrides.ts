import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import {
	READLIST_FIT_OVERRIDES_KEPT,
	ReadlistFitOverrideIdSchema,
	ReadlistPurposeVersionSchema,
	readlistFitOverrideId,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import type {
	DeleteReadlistArticleByUrl,
	DeleteReadlistFitOverride,
	ListReadlistFitOverrides,
	PurgeReadlistFitOverrides,
	ReadlistFitOverride,
	RecordReadlistFitOverride,
} from "@packages/provider-contracts/article-store";
import { z } from "zod";
import {
	readlistFitOverrideKey,
	readlistFitOverridePrefix,
	readlistPartitionValue,
} from "./user-readlist-partition";

const ReadlistFitOverrideRow = z.object({
	url: z.string(),
	articleUrl: z.string(),
	anchorText: z.string(),
	host: z.string(),
	engineVerdict: z.enum(["keep", "drop", "unsure"]).optional(),
	engineReason: z.string().optional(),
	readerVerdict: z.enum(["keep", "drop"]),
	purposeVersion: ReadlistPurposeVersionSchema.optional(),
	receivedAtMessageId: z.string(),
	ordinal: EmailLinkOrdinalSchema,
	createdAt: z.string(),
});

const UserArticleKeyRow = z.object({ userId: z.string(), url: z.string() });

export function initDynamoDbReadlistFitOverrides(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	recordReadlistFitOverride: RecordReadlistFitOverride;
	listReadlistFitOverrides: ListReadlistFitOverrides;
	deleteReadlistFitOverride: DeleteReadlistFitOverride;
	purgeReadlistFitOverrides: PurgeReadlistFitOverrides;
	deleteReadlistArticleByUrl: DeleteReadlistArticleByUrl;
} {
	const overrides = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: ReadlistFitOverrideRow,
	});
	const keys = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: UserArticleKeyRow,
	});

	const newestFirst = (params: { userId: UserId; readlist: ReadlistSlug; limit: number }) =>
		overrides.query({
			KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
			ExpressionAttributeNames: { "#url": "url" },
			ExpressionAttributeValues: {
				":userId": params.userId,
				":prefix": readlistFitOverridePrefix(params.readlist),
			},
			ConsistentRead: true,
			Limit: params.limit,
		});

	const recordReadlistFitOverride: RecordReadlistFitOverride = async ({ userId, readlist, override }) => {
		const id = readlistFitOverrideId(override);
		await overrides.put({
			Item: {
				userId,
				url: readlistFitOverrideKey({ readlist, id }),
				articleUrl: override.url,
				anchorText: override.anchorText,
				host: override.host,
				...(override.engineVerdict === undefined ? {} : { engineVerdict: override.engineVerdict }),
				...(override.engineReason === undefined ? {} : { engineReason: override.engineReason }),
				readerVerdict: override.readerVerdict,
				...(override.purposeVersion === undefined ? {} : { purposeVersion: override.purposeVersion }),
				receivedAtMessageId: override.receivedAtMessageId,
				ordinal: override.ordinal,
				createdAt: override.createdAt.toISOString(),
			},
			ConditionExpression: "attribute_not_exists(#url)",
			ExpressionAttributeNames: { "#url": "url" },
		});
		const { items } = await newestFirst({ userId, readlist, limit: READLIST_FIT_OVERRIDES_KEPT + 1 });
		for (const beyond of items.slice(READLIST_FIT_OVERRIDES_KEPT)) {
			await overrides.delete({ Key: { userId, url: beyond.url } });
		}
		return id;
	};

	const listReadlistFitOverrides: ListReadlistFitOverrides = async ({ userId, readlist }) => {
		const prefix = readlistFitOverridePrefix(readlist);
		const { items } = await newestFirst({ userId, readlist, limit: READLIST_FIT_OVERRIDES_KEPT });
		return items.map(
			(row): ReadlistFitOverride => ({
				id: ReadlistFitOverrideIdSchema.parse(row.url.slice(prefix.length)),
				url: row.articleUrl,
				anchorText: row.anchorText,
				host: row.host,
				...(row.engineVerdict === undefined ? {} : { engineVerdict: row.engineVerdict }),
				...(row.engineReason === undefined ? {} : { engineReason: row.engineReason }),
				readerVerdict: row.readerVerdict,
				...(row.purposeVersion === undefined ? {} : { purposeVersion: row.purposeVersion }),
				receivedAtMessageId: row.receivedAtMessageId,
				ordinal: row.ordinal,
				createdAt: new Date(row.createdAt),
			}),
		);
	};

	const deleteReadlistFitOverride: DeleteReadlistFitOverride = async ({ userId, readlist, id }) => {
		await overrides.delete({ Key: { userId, url: readlistFitOverrideKey({ readlist, id }) } });
	};

	const purgeReadlistFitOverrides: PurgeReadlistFitOverrides = async ({ userId, readlist }) => {
		await forEachQueryPage(
			keys,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":userId": userId, ":prefix": readlistFitOverridePrefix(readlist) },
			},
			async (rows) => {
				await Promise.all(rows.map((row) => keys.delete({ Key: { userId: row.userId, url: row.url } })));
			},
		);
	};

	const deleteReadlistArticleByUrl: DeleteReadlistArticleByUrl = async ({ userId, readlist, url }) => {
		try {
			await keys.delete({
				Key: {
					userId: readlistPartitionValue({ userId, readlist }),
					url: ArticleResourceUniqueId.parse(url).value,
				},
				ConditionExpression: "attribute_exists(savedAt)",
			});
			return true;
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return false;
			throw error;
		}
	};

	return {
		recordReadlistFitOverride,
		listReadlistFitOverrides,
		deleteReadlistFitOverride,
		purgeReadlistFitOverrides,
		deleteReadlistArticleByUrl,
	};
}
