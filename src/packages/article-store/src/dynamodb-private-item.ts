import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ReaderArticleHashId } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
	TransactWriteCommand,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import type {
	RecordPrivateItemFailure,
	RecordPrivateItemSections,
	SavePrivateItem,
} from "@packages/provider-contracts/article-store";
import { z } from "zod";

const ItemOwnerRow = z.object({ ownerUserId: dynamoField(UserIdSchema) });

function lostCondition(error: unknown): boolean {
	return (
		error instanceof TransactionCanceledException &&
		error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed") === true
	);
}

export function initDynamoDbPrivateItem(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	userArticlesTableName: string;
}): {
	savePrivateItem: SavePrivateItem;
	recordPrivateItemFailure: RecordPrivateItemFailure;
	recordPrivateItemSections: RecordPrivateItemSections;
} {
	const articles = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: ItemOwnerRow });

	const savePrivateItem: SavePrivateItem = async (params) => {
		const key = ArticleResourceUniqueId.parse(params.url).value;
		const routeId = ReaderArticleHashId.from(params.url).value;
		const savedAt = params.savedAt.toISOString();
		try {
			await deps.client.send(
				new TransactWriteCommand({
					TransactItems: [
						{
							Put: {
								TableName: deps.tableName,
								Item: {
									url: key,
									routeId,
									originalUrl: params.url,
									title: params.media.fileName,
									siteName: "Book",
									excerpt: "",
									wordCount: 0,
									estimatedReadTime: 0,
									savedAt,
									imageUrl: null,
									publishedOn: null,
									contentSelectionRevision: 1,
									ownerUserId: params.ownerUserId,
									media: { kind: params.media.kind, fileName: params.media.fileName, routeId },
									crawlStatus: "pending",
									crawlPendingSince: savedAt,
								},
								ConditionExpression: "attribute_not_exists(#url)",
								ExpressionAttributeNames: { "#url": "url" },
							},
						},
						{
							Put: {
								TableName: deps.userArticlesTableName,
								Item: {
									userId: params.ownerUserId,
									url: key,
									savedAt,
									status: "unread",
									provenance: { kind: "upload" },
								},
							},
						},
					],
				}),
			);
			return "saved";
		} catch (error) {
			if (!lostCondition(error)) throw error;
			const existing = await articles.get({ url: key }, { projection: ["ownerUserId"], consistentRead: true });
			assert(existing?.ownerUserId === params.ownerUserId, "a private item identity is saved by its uploader only");
			return "already-saved";
		}
	};

	const updateOwnedRow = async (update: {
		url: string;
		updateExpression: string;
		condition: string;
		values: Record<string, unknown>;
	}): Promise<"recorded" | "not-found"> => {
		try {
			await articles.update({
				Key: { url: ArticleResourceUniqueId.parse(update.url).value },
				UpdateExpression: update.updateExpression,
				ConditionExpression: update.condition,
				ExpressionAttributeValues: update.values,
			});
			return "recorded";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "not-found";
			throw error;
		}
	};

	const recordPrivateItemFailure: RecordPrivateItemFailure = (params) =>
		updateOwnedRow({
			url: params.url,
			updateExpression: "SET crawlStatus = :failed, crawlFailureReason = :reason, processingNotice = :notice",
			condition: "attribute_exists(ownerUserId)",
			values: {
				":failed": "failed",
				":reason": JSON.stringify({ kind: "processing-failed", notice: params.notice }),
				":notice": params.notice,
			},
		});

	const recordPrivateItemSections: RecordPrivateItemSections = (params) =>
		updateOwnedRow({
			url: params.url,
			updateExpression: "SET media.sectionCount = :sectionCount",
			condition: "attribute_exists(ownerUserId) AND attribute_not_exists(purgedAt)",
			values: { ":sectionCount": params.sectionCount },
		});

	return { savePrivateItem, recordPrivateItemFailure, recordPrivateItemSections };
}
