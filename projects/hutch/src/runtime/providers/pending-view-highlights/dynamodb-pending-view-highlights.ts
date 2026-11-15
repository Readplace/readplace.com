import assert from "node:assert";
import { type DynamoDBDocumentClient, defineDynamoTable, writeIfCondition } from "@packages/storage-client";
import { z } from "zod";
import {
	type ClaimPendingViewHighlights,
	PENDING_VIEW_HIGHLIGHTS_TTL_SECONDS,
	type StorePendingViewHighlights,
} from "./pending-view-highlights.types";

const PendingViewHighlightsRow = z.object({
	pendingId: z.string(),
	articleUrl: z.string(),
	items: z.array(
		z.object({
			url: z.string(),
			exact: z.string(),
			prefix: z.string(),
			suffix: z.string(),
			note: z.string().optional(),
		}),
	),
	expiresAt: z.number(),
});

export function initDynamoDbPendingViewHighlights(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	storePendingViewHighlights: StorePendingViewHighlights;
	claimPendingViewHighlights: ClaimPendingViewHighlights;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: PendingViewHighlightsRow,
	});

	const nowSeconds = () => Math.floor(deps.now().getTime() / 1000);

	const storePendingViewHighlights: StorePendingViewHighlights = async ({ pendingId, articleUrl, items }) => {
		await table.put({
			Item: {
				pendingId,
				articleUrl,
				items: items.map((item) => ({ ...item })),
				expiresAt: nowSeconds() + PENDING_VIEW_HIGHLIGHTS_TTL_SECONDS,
			},
		});
	};

	const claimPendingViewHighlights: ClaimPendingViewHighlights = async (pendingId) => {
		const outcome = await writeIfCondition(() =>
			table.delete({
				Key: { pendingId },
				ConditionExpression: "attribute_exists(#pendingId)",
				ExpressionAttributeNames: { "#pendingId": "pendingId" },
				ReturnValues: "ALL_OLD",
			}),
		);
		if (outcome.kind === "condition-failed") return undefined;
		const { Attributes } = outcome.result;
		assert(Attributes, "a conditional delete with ReturnValues ALL_OLD always returns the prior item");
		if (Attributes.expiresAt <= nowSeconds()) return undefined;
		return { articleUrl: Attributes.articleUrl, items: Attributes.items };
	};

	return { storePendingViewHighlights, claimPendingViewHighlights };
}
