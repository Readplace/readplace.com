import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { SimpleCrawl } from "@packages/crawl-article";
import { calculateReadTime } from "@packages/domain/article";
import {
	decideSummaryAutoHeal,
	incrementSummaryAutoHealAttempt,
	type LoadArticle,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { StaleCheckRequestedEvent } from "@packages/hutch-infra-components";
import { decideTerminalAction } from "@packages/test-fixtures/providers/article-freshness";
import type {
	FindArticleFreshness,
} from "@packages/test-fixtures/providers/article-store";
import type {
	FindArticleCrawlStatus,
} from "@packages/test-fixtures/providers/article-crawl";
import type {
	PublishRefreshArticleContent,
	PublishSaveAnonymousLink,
	PublishUpdateFetchTimestamp,
} from "@packages/test-fixtures/providers/events";
import type { ParseHtml } from "@packages/article-parser";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";

/**
 * Stale-check is now a simple-only worker: PDFs flow through the same
 * `SimpleCrawlUnsupportedEvent` → policy → `ComprehensiveCrawlCommand` chain
 * as the save-link Lambdas, so this handler no longer holds the mupdf / OCR
 * dependency footprint. The comprehensive Lambda emits
 * `RefreshContentExtractedEvent` (instead of `TierContentExtractedEvent` or
 * `RecrawlContentExtractedEvent`) when the `refresh=true` flag threads
 * through, keeping the existing tier-selection + canonical write flow
 * intact for refreshed PDFs.
 *
 * Action outcomes:
 *   - `"new"`             — row missing; re-published SaveAnonymousLinkCommand.
 *   - `"skip"`            — within TTL, terminal state, parse failure, or
 *                           simpleCrawl failure. No downstream effect.
 *   - `"unchanged"`       — 304 Not Modified; published UpdateFetchTimestamp.
 *   - `"refreshed"`       — HTML refetched + parsed; published RefreshArticleContent.
 *   - `"tier-1-deferred"` — non-HTML body; emitted SimpleCrawlUnsupportedEvent
 *                           with `refresh=true` so the comprehensive Lambda
 *                           ultimately drives the row through refresh-content-
 *                           extracted.
 */
export type StaleCheckAction =
	| "new"
	| "skip"
	| "unchanged"
	| "refreshed"
	| "tier-1-deferred";

const logPrefix = "[StaleCheckRequested]";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initStaleCheckHandler(deps: {
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	simpleCrawl: SimpleCrawl;
	parseHtml: ParseHtml;
	publishRefreshArticleContent: PublishRefreshArticleContent;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
	markCrawlStage: MarkCrawlStage;
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	staleTtlMs: number;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		findArticleFreshness,
		findArticleCrawlStatus,
		simpleCrawl,
		parseHtml,
		publishRefreshArticleContent,
		publishUpdateFetchTimestamp,
		publishSaveAnonymousLink,
		emitSimpleCrawlUnsupported,
		markCrawlStage,
		loadArticle,
		transitionAndPersist,
		now,
		staleTtlMs,
		logger,
	} = deps;

	async function checkAndRefresh(url: string): Promise<StaleCheckAction> {
		const freshness = await findArticleFreshness(url);
		if (!freshness) return "new";

		const crawl = await findArticleCrawlStatus(url);
		if (decideTerminalAction(crawl) === "skip") return "skip";

		if (freshness.contentFetchedAt) {
			const fetchedAt = new Date(freshness.contentFetchedAt).getTime();
			if (now().getTime() - fetchedAt < staleTtlMs) return "skip";
		}

		const result = await simpleCrawl({
			url,
			etag: freshness.etag,
			lastModified: freshness.lastModified,
		});

		if (result.status === "not-modified") {
			await publishUpdateFetchTimestamp({
				url,
				contentFetchedAt: now().toISOString(),
			});
			return "unchanged";
		}

		if (result.status === "failed") return "skip";

		if (result.status === "unsupported") {
			/* Mirror save-link-work's deferral: write the stage marker so the
			 * reader's progress bar advances immediately, then emit the event
			 * with `refresh=true` so the comprehensive Lambda emits
			 * RefreshContentExtractedEvent at the end. */
			await markCrawlStage({ url, stage: "comprehensive-fetching" });
			await emitSimpleCrawlUnsupported({ url, refresh: true });
			return "tier-1-deferred";
		}

		const parsed = parseHtml({ url, html: result.html, thumbnailUrl: result.thumbnailUrl });
		if (!parsed.ok) return "skip";

		await publishRefreshArticleContent({
			url,
			html: result.html,
			metadata: {
				title: parsed.article.title,
				siteName: parsed.article.siteName,
				excerpt: parsed.article.excerpt,
				wordCount: parsed.article.wordCount,
				imageUrl: parsed.article.imageUrl,
			},
			estimatedReadTime: calculateReadTime(parsed.article.wordCount),
			etag: result.etag,
			lastModified: result.lastModified,
			contentFetchedAt: now().toISOString(),
		});
		return "refreshed";
	}

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = StaleCheckRequestedEvent.detailSchema.parse(envelope.detail);

				logger.info(`${logPrefix} processing`, { url: detail.url });

				const action = await checkAndRefresh(detail.url);

				if (action === "new") {
					await publishSaveAnonymousLink({ url: detail.url });
					logger.info(`${logPrefix} re-published SaveAnonymousLinkCommand`, {
						url: detail.url,
						action,
					});
				} else if (action === "tier-1-deferred") {
					logger.info(`${logPrefix} tier-1 deferred to comprehensive Lambda`, {
						url: detail.url,
						action,
					});
				} else {
					logger.info(`${logPrefix} no-op`, { url: detail.url, action });
				}

				/* Summary auto-heal: reprime a summary-failed row once per
				 * stale-check tick, bounded by the attempt budget + TTL gate.
				 * Runs after refresh so a successful refresh (which resets
				 * summary to pending) skips the heal naturally. */
				const article = await loadArticle(detail.url);
				if (article !== undefined) {
					const decision = decideSummaryAutoHeal(article, now());
					if (decision === "reprime") {
						await transitionAndPersist(incrementSummaryAutoHealAttempt, {
							url: detail.url,
							input: { now: now().toISOString() },
						});
						logger.info(`${logPrefix} reprimed summary auto-heal`, {
							url: detail.url,
							attempts: article.summaryAutoHeal.attempts + 1,
						});
					}
				}
			} catch (error) {
				logger.error(`${logPrefix} record failed`, {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
