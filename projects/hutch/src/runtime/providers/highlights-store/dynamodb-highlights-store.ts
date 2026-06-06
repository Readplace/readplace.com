/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { randomBytes } from "node:crypto";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ReaderArticleHashId, ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { ReaderArticleHashId as ReaderArticleHashIdType } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import type {
	CreateHighlight,
	DeleteHighlight,
	FindHighlightsByArticle,
} from "@packages/provider-contracts/highlights-store";
import { HighlightIdSchema } from "@packages/domain/highlight";

/** `pk` collapses the (userId, articleId) pair into one partition so every
 * highlight for an article a user owns is a single Query. `id` is the range key
 * so individual highlights can be deleted by primary key. */
const HighlightRow = z.object({
	pk: z.string(),
	id: HighlightIdSchema,
	userId: UserIdSchema,
	articleId: ReaderArticleHashIdSchema,
	quote: z.string(),
	note: z.string(),
	createdAt: z.string(),
});

function partitionKey(userId: UserId, articleId: ReaderArticleHashIdType): string {
	return `${userId}#${articleId.value}`;
}

export function initDynamoDbHighlightsStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	createHighlight: CreateHighlight;
	findHighlightsByArticle: FindHighlightsByArticle;
	deleteHighlight: DeleteHighlight;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: HighlightRow,
	});

	const createHighlight: CreateHighlight = async ({ userId, articleId, quote, note }) => {
		const id = HighlightIdSchema.parse(randomBytes(16).toString("hex"));
		const createdAt = deps.now().toISOString();
		await table.put({
			Item: {
				pk: partitionKey(userId, articleId),
				id,
				userId,
				articleId: articleId.value,
				quote,
				note,
				createdAt,
			},
		});
		return { id, userId, articleId, quote, note, createdAt: new Date(createdAt) };
	};

	const findHighlightsByArticle: FindHighlightsByArticle = async ({ userId, articleId }) => {
		const { items } = await table.query({
			KeyConditionExpression: "#pk = :pk",
			ExpressionAttributeNames: { "#pk": "pk" },
			ExpressionAttributeValues: { ":pk": partitionKey(userId, articleId) },
		});
		return items
			.map((row) => ({
				id: row.id,
				userId: row.userId,
				articleId: ReaderArticleHashId.fromHash(row.articleId.value),
				quote: row.quote,
				note: row.note,
				createdAt: new Date(row.createdAt),
			}))
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	};

	const deleteHighlight: DeleteHighlight = async ({ userId, articleId, id }) => {
		const { Attributes } = await table.delete({
			Key: { pk: partitionKey(userId, articleId), id },
			ReturnValues: "ALL_OLD",
		});
		return Attributes !== undefined;
	};

	return { createHighlight, findHighlightsByArticle, deleteHighlight };
}
/* c8 ignore stop */
