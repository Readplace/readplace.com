import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ListHighlightsOfArticle, UserHighlight, WriteHighlightAnchor } from "@packages/provider-contracts/highlights";
import { type DynamoDBDocumentClient, defineDynamoTable, forEachQueryPage, writeIfCondition } from "@packages/storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { HighlightRow, highlightKey, toHighlight } from "./dynamodb-highlights";

const HIGHLIGHT_OF_INDEX = "highlightOf-index";

export function initDynamoDbHighlightAnchors(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	listHighlightsOfArticle: ListHighlightsOfArticle;
	writeHighlightAnchor: WriteHighlightAnchor;
} {
	const highlights = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: HighlightRow,
	});

	const listHighlightsOfArticle: ListHighlightsOfArticle = async (url) => {
		const found: UserHighlight[] = [];
		await forEachQueryPage(
			highlights,
			{
				IndexName: HIGHLIGHT_OF_INDEX,
				KeyConditionExpression: "highlightOf = :highlightOf",
				ExpressionAttributeValues: { ":highlightOf": ArticleResourceUniqueId.parse(url).value },
			},
			async (rows) => {
				for (const row of rows) found.push({ userId: UserIdSchema.parse(row.userId), highlight: toHighlight(row) });
			},
		);
		return found;
	};

	const writeHighlightAnchor: WriteHighlightAnchor = async ({ userId, url, highlightId, expectedRevision, anchor }) => {
		const candidate =
			anchor.anchoredCandidateId === undefined
				? { set: "", remove: " REMOVE anchoredCandidateId", values: {} }
				: {
						set: ", anchoredCandidateId = :anchoredCandidateId",
						remove: "",
						values: { ":anchoredCandidateId": anchor.anchoredCandidateId },
					};
		const outcome = await writeIfCondition(() =>
			highlights.update({
				Key: { userId, url: highlightKey({ url, highlightId }) },
				UpdateExpression: `SET #start = :start, #end = :end, anchorState = :anchorState, anchoredContentHash = :anchoredContentHash, orderKey = :orderKey, anchorRevision = anchorRevision + :one${candidate.set}${candidate.remove}`,
				ConditionExpression: "anchorRevision = :expectedRevision AND attribute_exists(#url)",
				ExpressionAttributeNames: { "#url": "url", "#start": "start", "#end": "end" },
				ExpressionAttributeValues: {
					":start": anchor.start,
					":end": anchor.end,
					":anchorState": anchor.anchorState,
					":anchoredContentHash": anchor.anchoredContentHash,
					":orderKey": anchor.orderKey,
					":one": 1,
					":expectedRevision": expectedRevision,
					...candidate.values,
				},
				ReturnValuesOnConditionCheckFailure: "ALL_OLD",
			}),
		);
		if (outcome.kind === "written") return { outcome: "written" };
		return { outcome: outcome.oldItem === undefined ? "deleted" : "stale" };
	};

	return { listHighlightsOfArticle, writeHighlightAnchor };
}
