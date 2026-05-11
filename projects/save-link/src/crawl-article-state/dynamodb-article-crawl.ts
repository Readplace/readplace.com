import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../save-link/article-resource-unique-id";
import type {
	MarkCrawlFailed,
	MarkCrawlReady,
	MarkCrawlStage,
	MarkCrawlUnsupported,
} from "./article-crawl.types";

const CrawlStateRow = z.object({
	url: z.string(),
});

async function swallowConditionalCheckFailure(
	action: () => Promise<void>,
): Promise<void> {
	try {
		await action();
	} catch (err) {
		/* c8 ignore next -- V8 block-coverage phantom on the catch-clause continuation branch, see bcoe/c8#319 */
		if (!(err instanceof ConditionalCheckFailedException)) throw err;
	}
}

export function initDynamoDbArticleCrawl(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	markCrawlReady: MarkCrawlReady;
	markCrawlFailed: MarkCrawlFailed;
	markCrawlUnsupported: MarkCrawlUnsupported;
	markCrawlStage: MarkCrawlStage;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CrawlStateRow,
	});

	const markCrawlReady: MarkCrawlReady = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Unconditional: a successful crawl always wins over pending or a prior
		// failure (manual retry, re-save). REMOVE clears any lingering reason so
		// a later ready row is never interpreted as partially failed.
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression:
				"SET crawlStatus = :ready REMOVE crawlFailureReason, crawlFailedAt",
			ExpressionAttributeValues: {
				":ready": "ready",
			},
		});
	};

	const markCrawlFailed: MarkCrawlFailed = async ({ url, reason }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Allow pending → failed (normal) and failed → failed (redrive that fails
		// again, possibly with a new reason). Block ready from regressing.
		await swallowConditionalCheckFailure(() =>
			table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET crawlStatus = :failed, crawlFailureReason = :reason, crawlFailedAt = :failedAt",
				ConditionExpression:
					"attribute_not_exists(crawlStatus) OR crawlStatus = :pending OR crawlStatus = :failed",
				ExpressionAttributeValues: {
					":failed": "failed",
					":pending": "pending",
					":reason": reason,
					":failedAt": new Date().toISOString(),
				},
			}),
		);
	};

	const markCrawlUnsupported: MarkCrawlUnsupported = async ({ url, reason }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Allow pending → unsupported (normal) and failed → unsupported (e.g. an
		// operator recrawl that hit a non-html origin this time). Block ready from
		// regressing. Reuses crawlFailedAt as the terminal-failure timestamp.
		await swallowConditionalCheckFailure(() =>
			table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET crawlStatus = :unsupported, crawlUnsupportedReason = :reason, crawlFailedAt = :failedAt",
				ConditionExpression:
					"attribute_not_exists(crawlStatus) OR crawlStatus = :pending OR crawlStatus = :failed OR crawlStatus = :unsupported",
				ExpressionAttributeValues: {
					":unsupported": "unsupported",
					":pending": "pending",
					":failed": "failed",
					":reason": reason,
					":failedAt": new Date().toISOString(),
				},
			}),
		);
	};

	const markCrawlStage: MarkCrawlStage = async ({ url, stage }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		// Unconditional write: stages are monotonic by code order in the
		// save-link worker, the worker is the only writer, and SQS redelivery
		// just repeats the same sequence. We accept a brief regression on
		// redelivery rather than the cost of a conditional check at every
		// milestone.
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression: "SET crawlStage = :stage",
			ExpressionAttributeValues: { ":stage": stage },
		});
	};

	return { markCrawlReady, markCrawlFailed, markCrawlUnsupported, markCrawlStage };
}
