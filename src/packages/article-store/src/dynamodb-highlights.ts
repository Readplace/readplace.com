import { CandidateIdSchema } from "@packages/article-state-types";
import { AnchorStateSchema, type Highlight, HighlightIdSchema } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	CreateHighlight,
	DeleteAllUserHighlights,
	DeleteArticleHighlights,
	DeleteHighlight,
	ListArticleHighlights,
} from "@packages/provider-contracts/highlights";
import {
	type DynamoDBDocumentClient,
	TransactionCanceledException,
	TransactWriteCommand,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
	writeIfCondition,
} from "@packages/storage-client";
import { z } from "zod";
import { HIGHLIGHT_KEY_PREFIX } from "./user-readlist-partition";

const HighlightRow = z.object({
	userId: z.string(),
	url: z.string(),
	highlightId: HighlightIdSchema,
	highlightOf: z.string(),
	exact: z.string(),
	prefix: z.string(),
	suffix: z.string(),
	start: z.number(),
	end: z.number(),
	anchoredContentHash: z.string(),
	anchoredCandidateId: dynamoField(CandidateIdSchema),
	anchorState: AnchorStateSchema,
	orderKey: z.number(),
	note: dynamoField(z.string()),
	createdAt: z.string(),
	updatedAt: z.string(),
	anchorRevision: z.number(),
});

function articleHighlightsPrefix(url: string): string {
	return `${HIGHLIGHT_KEY_PREFIX}${url}/`;
}

function highlightKey(params: { url: string; highlightId: string }): string {
	return `${articleHighlightsPrefix(params.url)}${params.highlightId}`;
}

function toHighlight(row: z.infer<typeof HighlightRow>): Highlight {
	return {
		highlightId: row.highlightId,
		highlightOf: row.highlightOf,
		exact: row.exact,
		prefix: row.prefix,
		suffix: row.suffix,
		start: row.start,
		end: row.end,
		anchoredContentHash: row.anchoredContentHash,
		...(row.anchoredCandidateId === undefined ? {} : { anchoredCandidateId: row.anchoredCandidateId }),
		anchorState: row.anchorState,
		orderKey: row.orderKey,
		...(row.note === undefined ? {} : { note: row.note }),
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
		anchorRevision: row.anchorRevision,
	};
}

function toItem(params: { userId: UserId; highlight: Highlight }): Record<string, unknown> {
	const { highlight } = params;
	return {
		userId: params.userId,
		url: highlightKey({ url: highlight.highlightOf, highlightId: highlight.highlightId }),
		highlightId: highlight.highlightId,
		highlightOf: highlight.highlightOf,
		exact: highlight.exact,
		prefix: highlight.prefix,
		suffix: highlight.suffix,
		start: highlight.start,
		end: highlight.end,
		anchoredContentHash: highlight.anchoredContentHash,
		...(highlight.anchoredCandidateId === undefined ? {} : { anchoredCandidateId: highlight.anchoredCandidateId }),
		anchorState: highlight.anchorState,
		orderKey: highlight.orderKey,
		...(highlight.note === undefined ? {} : { note: highlight.note }),
		createdAt: highlight.createdAt.toISOString(),
		updatedAt: highlight.updatedAt.toISOString(),
		anchorRevision: highlight.anchorRevision,
	};
}

export function initDynamoDbHighlights(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	listArticleHighlights: ListArticleHighlights;
	createHighlight: CreateHighlight;
	deleteHighlight: DeleteHighlight;
	deleteArticleHighlights: DeleteArticleHighlights;
	deleteAllUserHighlights: DeleteAllUserHighlights;
} {
	const tableName = deps.userArticlesTableName;
	const highlights = defineDynamoTable({ client: deps.client, tableName, schema: HighlightRow });

	const forEachArticleHighlightPage = (
		params: { userId: UserId; url: string },
		onPage: (rows: z.infer<typeof HighlightRow>[]) => Promise<void>,
	) =>
		forEachQueryPage(
			highlights,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				FilterExpression: "highlightOf = :highlightOf",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":userId": params.userId,
					":prefix": articleHighlightsPrefix(params.url),
					":highlightOf": params.url,
				},
				ConsistentRead: true,
			},
			onPage,
		);

	const deleteRows = async (rows: z.infer<typeof HighlightRow>[]) => {
		await Promise.all(rows.map((row) => highlights.delete({ Key: { userId: row.userId, url: row.url } })));
	};

	const listArticleHighlights: ListArticleHighlights = async (params) => {
		const rows: z.infer<typeof HighlightRow>[] = [];
		await forEachArticleHighlightPage(params, async (page) => {
			rows.push(...page);
		});
		return rows
			.map(toHighlight)
			.sort((a, b) => a.orderKey - b.orderKey || a.highlightId.localeCompare(b.highlightId));
	};

	const createHighlight: CreateHighlight = async ({ userId, highlight, replacedIds }) => {
		const item = toItem({ userId, highlight });
		if (replacedIds.length === 0) {
			const outcome = await writeIfCondition(() =>
				highlights.put({
					Item: item,
					ConditionExpression: "attribute_not_exists(#url)",
					ExpressionAttributeNames: { "#url": "url" },
				}),
			);
			if (outcome.kind === "condition-failed") return { status: "cancelled" };
			return { status: "created", highlight, replacedIds };
		}
		try {
			await deps.client.send(
				new TransactWriteCommand({
					TransactItems: [
						{
							Put: {
								TableName: tableName,
								Item: item,
								ConditionExpression: "attribute_not_exists(#url)",
								ExpressionAttributeNames: { "#url": "url" },
							},
						},
						...replacedIds.map((highlightId) => ({
							Delete: {
								TableName: tableName,
								Key: { userId, url: highlightKey({ url: highlight.highlightOf, highlightId }) },
								ConditionExpression: "attribute_exists(#url)",
								ExpressionAttributeNames: { "#url": "url" },
							},
						})),
					],
				}),
			);
		} catch (error) {
			if (error instanceof TransactionCanceledException) return { status: "cancelled" };
			throw error;
		}
		return { status: "merged", highlight, replacedIds };
	};

	const deleteHighlight: DeleteHighlight = async ({ userId, url, highlightId }) => {
		const outcome = await writeIfCondition(() =>
			highlights.delete({
				Key: { userId, url: highlightKey({ url, highlightId }) },
				ConditionExpression: "attribute_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
			}),
		);
		return { deleted: outcome.kind === "written" };
	};

	const deleteArticleHighlights: DeleteArticleHighlights = async (params) => {
		await forEachArticleHighlightPage(params, deleteRows);
	};

	const deleteAllUserHighlights: DeleteAllUserHighlights = async (userId) => {
		await forEachQueryPage(
			highlights,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":userId": userId, ":prefix": HIGHLIGHT_KEY_PREFIX },
			},
			deleteRows,
		);
	};

	return {
		listArticleHighlights,
		createHighlight,
		deleteHighlight,
		deleteArticleHighlights,
		deleteAllUserHighlights,
	};
}
