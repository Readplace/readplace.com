/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { randomBytes } from "node:crypto";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { HighlightIdSchema } from "@packages/domain/highlight";
import type { Highlight, HighlightStore } from "@packages/domain/highlight";

const HighlightRow = z.object({
	pk: z.string(),
	highlightId: HighlightIdSchema,
	userId: UserIdSchema,
	articleId: z.string(),
	start: z.number().int().min(0),
	end: z.number().int().min(0),
	quote: z.string(),
	note: dynamoField(z.string()),
	createdAt: z.string(),
});

function partitionKey(userId: string, articleId: string): string {
	return `${userId}#${articleId}`;
}

function toHighlight(row: z.infer<typeof HighlightRow>): Highlight {
	return {
		id: row.highlightId,
		userId: row.userId,
		articleId: row.articleId,
		anchor: { start: row.start, end: row.end, quote: row.quote },
		note: row.note,
		createdAt: row.createdAt,
	};
}

export function initDynamoDbHighlight(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): HighlightStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: HighlightRow,
	});

	return {
		saveHighlight: async ({ userId, articleId, anchor, note }) => {
			const id = HighlightIdSchema.parse(randomBytes(16).toString("hex"));
			const createdAt = deps.now().toISOString();
			await table.put({
				Item: {
					pk: partitionKey(userId, articleId),
					highlightId: id,
					userId,
					articleId,
					start: anchor.start,
					end: anchor.end,
					quote: anchor.quote,
					createdAt,
					...(note !== undefined ? { note } : {}),
				},
			});
			return { id, userId, articleId, anchor, note, createdAt };
		},
		findHighlightsByArticle: async ({ userId, articleId }) => {
			const { items } = await table.query({
				KeyConditionExpression: "pk = :pk",
				ExpressionAttributeValues: { ":pk": partitionKey(userId, articleId) },
			});
			return items
				.map(toHighlight)
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		},
		updateHighlightNote: async ({ id, userId, articleId, note }) => {
			const trimmed = note.trim();
			const clearing = trimmed === "";
			try {
				await table.update({
					Key: { pk: partitionKey(userId, articleId), highlightId: id },
					ConditionExpression: "attribute_exists(highlightId) AND userId = :uid",
					...(clearing
						? {
								UpdateExpression: "REMOVE note",
								ExpressionAttributeValues: { ":uid": userId },
							}
						: {
								UpdateExpression: "SET note = :n",
								ExpressionAttributeValues: { ":uid": userId, ":n": trimmed },
							}),
				});
			} catch (error) {
				// A missing or unowned row fails the condition — treat as a no-op,
				// matching the in-memory store's "ignore unknown" semantics.
				if (error instanceof Error && error.name === "ConditionalCheckFailedException") return;
				throw error;
			}
		},
		deleteHighlight: async ({ id, userId, articleId }) => {
			await table.delete({
				Key: { pk: partitionKey(userId, articleId), highlightId: id },
			});
		},
	};
}
/* c8 ignore stop */
