import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { MarkSummaryStage } from "../../domain/generate-summary/summary-stage.types";

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
