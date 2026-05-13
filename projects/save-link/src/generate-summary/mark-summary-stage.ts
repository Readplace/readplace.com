import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../save-link/article-resource-unique-id";

/**
 * Worker-side stage strings for the unified article-body progress bar.
 * Mirrors the hutch progress-mapping SummaryStage union — kept as a literal
 * type to keep the save-link package free of cross-project relative imports.
 * Terminal stages are omitted because by the time the worker would write
 * them the row's status attribute has already flipped to a terminal value.
 */
export type SummaryStage = "summary-started" | "summary-generating";

export type MarkSummaryStage = (params: {
	url: string;
	stage: SummaryStage;
}) => Promise<void>;

const SummaryStageRow = z.object({ url: z.string() });

/* Stage writes are transient progress markers; status writers (aggregate
 * transitions) REMOVE the stage attribute on transitions to terminal states,
 * so we keep the stage writer separate from the aggregate. */
export function initDynamoDbMarkSummaryStage(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { markSummaryStage: MarkSummaryStage } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: SummaryStageRow,
	});

	const markSummaryStage: MarkSummaryStage = async ({ url, stage }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Unconditional: stage writes are monotonic by code order in the
		// summariser. SQS redelivery just rewrites the same sequence.
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression: "SET summaryStage = :stage",
			ExpressionAttributeValues: { ":stage": stage },
		});
	};

	return { markSummaryStage };
}
