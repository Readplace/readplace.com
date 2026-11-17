import { type DynamoDBDocumentClient, defineDynamoTable } from "@packages/storage-client";
import { z } from "zod";
import {
	type FindPendingViewHighlights,
	PENDING_VIEW_HIGHLIGHTS_TTL_SECONDS,
	type ReleasePendingViewHighlights,
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
	findPendingViewHighlights: FindPendingViewHighlights;
	releasePendingViewHighlights: ReleasePendingViewHighlights;
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

	const findPendingViewHighlights: FindPendingViewHighlights = async (pendingId) => {
		const row = await table.get({ pendingId }, { consistentRead: true });
		if (row === undefined || row.expiresAt <= nowSeconds()) return undefined;
		return { articleUrl: row.articleUrl, items: row.items };
	};

	const releasePendingViewHighlights: ReleasePendingViewHighlights = async (pendingId) => {
		await table.delete({ Key: { pendingId } });
	};

	return { storePendingViewHighlights, findPendingViewHighlights, releasePendingViewHighlights };
}
