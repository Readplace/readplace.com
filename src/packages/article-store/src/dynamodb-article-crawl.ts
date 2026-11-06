import { CrawlStatusSchema } from "@packages/article-state-types";
import {
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	writeIfCondition,
} from "@packages/storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
	FindArticleCrawlStatuses,
	ForceMarkCrawlPending,
	CrawlPendingMark,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";
import { LEGACY_PENDING_SINCE } from "./dynamodb-article-store";
import { decodeCrawlColumns } from "./status-columns";

export const ArticleCrawlRow = z.object({
	url: z.string(),
	crawlStatus: dynamoField(CrawlStatusSchema),
	crawlFailureReason: dynamoField(z.string()),
	crawlUnsupportedReason: dynamoField(z.string()),
	crawlStage: dynamoField(
		z.enum([
			"crawl-fetching",
			"crawl-fetched",
			"comprehensive-fetching",
			"comprehensive-extracting",
			"comprehensive-cleaning",
			"crawl-parsed",
			"crawl-metadata-written",
			"crawl-content-uploaded",
		]),
	),
	crawlPartCurrent: dynamoField(z.number()),
	crawlPartTotal: dynamoField(z.number()),
	crawlOutcomeRevision: dynamoField(z.number()),
	resolutionOnViewClaimedAt: dynamoField(z.string()),
	crawlStartedAt: dynamoField(z.string()),
	crawlPendingSince: dynamoField(z.string()),
});

type ArticleCrawlRowShape = z.infer<typeof ArticleCrawlRow>;

function crawlOf(row: ArticleCrawlRowShape | undefined): ArticleCrawl | undefined {
	if (!row) return undefined;
	const columns = decodeCrawlColumns(row);
	if (columns.crawlStatus === "failed") {
		return {
			status: "failed",
			reason: columns.crawlFailureReason,
			outcomeRevision: row.crawlOutcomeRevision ?? 0,
		};
	}
	if (columns.crawlStatus === "unsupported") {
		return { status: "unsupported", reason: columns.crawlUnsupportedReason };
	}
	if (columns.crawlStatus === "pending") {
		const parts =
			row.crawlPartCurrent !== undefined && row.crawlPartTotal !== undefined
				? { current: row.crawlPartCurrent, total: row.crawlPartTotal }
				: undefined;
		const pending: ArticleCrawl = {
			status: "pending",
			startedAt: row.crawlStartedAt ?? row.crawlPendingSince ?? LEGACY_PENDING_SINCE,
		};
		if (row.crawlStage) pending.stage = row.crawlStage;
		if (parts) pending.parts = parts;
		return pending;
	}
	if (columns.crawlStatus === "ready") return { status: "ready" };
	// Legacy row (status attribute missing). Return undefined so the caller
	// defers to whether S3 content exists — pre-S3-migration content lived in
	// the row, but post-migration rows have empty `content` while S3 holds the
	// body. Either way, the reader-slot dispatcher's content check resolves to
	// ready (content present) or unavailable (no content anywhere).
	return undefined;
}

export function rowToArticleCrawl(row: ArticleCrawlRowShape | undefined): ArticleCrawl | undefined {
	const crawl = crawlOf(row);
	const claimedAt = row?.resolutionOnViewClaimedAt;
	if (crawl === undefined || claimedAt === undefined) return crawl;
	return { ...crawl, resolutionOnViewClaimedAt: claimedAt };
}

// Loose schema for the batch read: batchGetFromTable runs `schema.parse` on
// every returned item, so a strict schema would discard the whole batch on one
// malformed row. Each row is re-validated strictly below, per row.
const LooseArticleCrawlRow = z.looseObject({ url: z.string() });

const RefusedCrawlPendingRow = z.object({
	crawlStatus: z.object({ S: CrawlStatusSchema.extract(["pending", "ready"]) }),
	meteredLegsDeferredSince: z.object({ S: z.string() }).optional(),
});

function refusedCrawlPendingMark(oldItem: unknown): CrawlPendingMark {
	const row = RefusedCrawlPendingRow.parse(oldItem);
	return { kind: "refused", crawlStatus: row.crawlStatus.S, carriedMarker: row.meteredLegsDeferredSince !== undefined };
}

export function initDynamoDbArticleCrawl(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	findArticleCrawlStatuses: FindArticleCrawlStatuses;
	markCrawlPending: MarkCrawlPending;
	forceMarkCrawlPending: ForceMarkCrawlPending;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ArticleCrawlRow,
	});

	const findArticleCrawlStatus: FindArticleCrawlStatus = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get({ url: articleResourceUniqueId.value });
		return rowToArticleCrawl(row);
	};

	const findArticleCrawlStatuses: FindArticleCrawlStatuses = async (urls) => {
		const result = new Map<string, ArticleCrawl | undefined>();
		const keyToUrls = new Map<string, string[]>();
		for (const url of urls) {
			let normalizedKey: string;
			try {
				normalizedKey = ArticleResourceUniqueId.parse(url).value;
			} catch {
				result.set(url, undefined);
				continue;
			}
			const group = keyToUrls.get(normalizedKey);
			if (group) group.push(url);
			else keyToUrls.set(normalizedKey, [url]);
		}
		if (keyToUrls.size === 0) return result;

		const rows = await batchGetFromTable({
			client: deps.client,
			tableName: deps.tableName,
			schema: LooseArticleCrawlRow,
			keys: [...keyToUrls.keys()].map((url) => ({ url })),
			projection: ArticleCrawlRow.keyof().options,
		});

		const valueByKey = new Map<string, ArticleCrawl | undefined>();
		for (const row of rows) {
			const parsed = ArticleCrawlRow.safeParse(row);
			let value: ArticleCrawl | undefined;
			if (parsed.success) {
				try {
					value = rowToArticleCrawl(parsed.data);
				} catch {
					value = undefined;
				}
			}
			valueByKey.set(row.url, value);
		}
		for (const [key, groupUrls] of keyToUrls) {
			const value = valueByKey.get(key);
			for (const url of groupUrls) result.set(url, value);
		}
		return result;
	};

	const markCrawlPending: MarkCrawlPending = async ({ url, measured, meteredLegs }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const setPending = measured
			? "SET crawlStatus = :pending, crawlPendingSince = :pendingSince, crawlStartedAt = if_not_exists(crawlStartedAt, :pendingSince)"
			: "SET crawlStatus = :pending, crawlPendingSince = :pendingSince";
		const pendingSince = deps.now().toISOString();
		const outcome = await writeIfCondition(() =>
			table.update(
				meteredLegs === "deferred"
					? {
							Key: { url: articleResourceUniqueId.value },
							UpdateExpression: `${setPending}, meteredLegsDeferredSince = if_not_exists(meteredLegsDeferredSince, :pendingSince)`,
							ConditionExpression:
								"attribute_not_exists(crawlStatus) OR crawlStatus IN (:failed, :unsupported)",
							ExpressionAttributeValues: {
								":pending": "pending",
								":pendingSince": pendingSince,
								":failed": "failed",
								":unsupported": "unsupported",
							},
							ReturnValuesOnConditionCheckFailure: "ALL_OLD",
						}
					: {
							Key: { url: articleResourceUniqueId.value },
							UpdateExpression: `${setPending} REMOVE meteredLegsDeferredSince`,
							ConditionExpression:
								"attribute_not_exists(crawlStatus) OR crawlStatus <> :ready",
							ExpressionAttributeValues: {
								":pending": "pending",
								":pendingSince": pendingSince,
								":ready": "ready",
							},
							ReturnValuesOnConditionCheckFailure: "ALL_OLD",
						},
			),
		);
		if (outcome.kind === "written") return { kind: "marked" };
		if (meteredLegs === "run") {
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: "REMOVE meteredLegsDeferredSince",
			});
		}
		return refusedCrawlPendingMark(outcome.oldItem);
	};

	const forceMarkCrawlPending: ForceMarkCrawlPending = async ({ url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression:
				"SET crawlStatus = :pending, crawlPendingSince = :pendingSince REMOVE crawlFailureReason, crawlUnsupportedReason, crawlStartedAt, #ledgerResidential, #ledgerUnlockerFetch, #ledgerUnlockerRender, #ledgerComprehensive, #ledgerContentJudge, meteredLegsDeferredSince",
			ExpressionAttributeNames: {
				"#ledgerResidential": "ledger_render-residential-per-gb",
				"#ledgerUnlockerFetch": "ledger_render-web-unlocker-fetch",
				"#ledgerUnlockerRender": "ledger_render-web-unlocker-render",
				"#ledgerComprehensive": "ledger_comprehensive",
				"#ledgerContentJudge": "ledger_content-judge",
			},
			ExpressionAttributeValues: {
				":pending": "pending",
				":pendingSince": deps.now().toISOString(),
			},
		});
	};

	return {
		findArticleCrawlStatus,
		findArticleCrawlStatuses,
		markCrawlPending,
		forceMarkCrawlPending,
	};
}
