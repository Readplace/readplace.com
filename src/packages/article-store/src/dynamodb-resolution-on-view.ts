import assert from "node:assert";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { resolutionOnViewCoolDownCutoff, shownSummary } from "@packages/domain/article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	ClaimResolutionOnView,
	ResolutionAxes,
} from "@packages/provider-contracts/article-resolution-on-view";
import { ArticleCrawlRow, rowToArticleCrawl } from "./dynamodb-article-crawl";
import { ArticleSummaryRow, rowToGeneratedSummary } from "./dynamodb-generated-summary";

const ResolutionOnViewRow = ArticleCrawlRow.extend(ArticleSummaryRow.shape);

const CLAIM_BY_AXES: Record<ResolutionAxes, { UpdateExpression: string; ConditionExpression: string; values: Record<string, string> }> = {
	"crawl-and-summary": {
		UpdateExpression:
			"SET crawlStatus = :pending, crawlPendingSince = :now, summaryStatus = :pending, summaryPendingSince = :now, resolutionOnViewClaimedAt = :now REMOVE crawlFailureReason, crawlUnsupportedReason, crawlStartedAt, summaryFailureReason, summarySkippedReason, meteredLegsDeferredSince",
		ConditionExpression:
			"crawlStatus IN (:failed, :unsupported) AND (attribute_not_exists(resolutionOnViewClaimedAt) OR resolutionOnViewClaimedAt < :coolDownCutoff)",
		values: { ":failed": "failed", ":unsupported": "unsupported" },
	},
	summary: {
		UpdateExpression:
			"SET summaryStatus = :pending, summaryPendingSince = :now, resolutionOnViewClaimedAt = :now REMOVE summaryFailureReason, summarySkippedReason, meteredLegsDeferredSince",
		ConditionExpression:
			"crawlStatus = :ready AND (summaryStatus = :failed OR (summaryStatus = :skipped AND summarySkippedReason IN (:awaitingReader, :aiUnavailable))) AND (attribute_not_exists(resolutionOnViewClaimedAt) OR resolutionOnViewClaimedAt < :coolDownCutoff)",
		values: {
			":ready": "ready",
			":failed": "failed",
			":skipped": "skipped",
			":awaitingReader": "awaiting-reader",
			":aiUnavailable": "ai-unavailable",
		},
	},
};

export function initDynamoDbClaimResolutionOnView(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): ClaimResolutionOnView {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ResolutionOnViewRow,
	});

	return async ({ url, axes, viewer }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const claim = CLAIM_BY_AXES[axes];
		const now = deps.now();
		try {
			const { Attributes: row } = await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: claim.UpdateExpression,
				ConditionExpression: claim.ConditionExpression,
				ExpressionAttributeValues: {
					":pending": "pending",
					":now": now.toISOString(),
					":coolDownCutoff": resolutionOnViewCoolDownCutoff(now),
					...claim.values,
				},
				ReturnValues: "ALL_NEW",
			});
			assert(row, "a claimed resolution-on-view row must come back with ReturnValues ALL_NEW");
			const crawl = rowToArticleCrawl(row);
			assert(crawl, "a claimed resolution-on-view row must carry a crawlStatus");
			return {
				kind: "claimed",
				crawl,
				summary: shownSummary({ url, summary: rowToGeneratedSummary(row), viewer, ownerUserId: row.ownerUserId }),
			};
		} catch (err) {
			if (err instanceof ConditionalCheckFailedException) return { kind: "not-eligible" };
			throw err;
		}
	};
}
