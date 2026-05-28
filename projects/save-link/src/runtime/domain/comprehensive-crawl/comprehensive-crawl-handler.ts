import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ComprehensiveCrawl } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import {
	ComprehensiveCrawlCommand,
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { MarkCrawlProgress } from "../../providers/article-crawl/mark-crawl-progress";
import { initProgressThrottle } from "../crawl-article-state/init-progress-throttle";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { FinalizeArticle } from "../save-link/finalize-article";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initComprehensiveCrawlHandler(deps: {
	comprehensiveCrawl: ComprehensiveCrawl;
	finalizeArticle: FinalizeArticle;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	markCrawlProgress: MarkCrawlProgress;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	progressIntervalMs?: number;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		comprehensiveCrawl,
		finalizeArticle,
		putTierSource,
		updateFetchTimestamp,
		transitionAndPersist,
		markCrawlStage,
		markCrawlProgress,
		publishEvent,
		now,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
		progressIntervalMs = 1500,
	} = deps;

	const logPrefix = "[ComprehensiveCrawlCommand]";

	const emitTier1Failure = async (url: string): Promise<void> => {
		const snapshot = await readTierSnapshot({ url });
		logCrawlOutcome({
			url,
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: snapshot.tier0Status,
			pickedTier: snapshot.pickedTier,
		});
	};

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = ComprehensiveCrawlCommand.detailSchema.parse(envelope.detail);
				const { url, userId, recrawl, refresh } = detail;

				logger.info(`${logPrefix} processing`, {
					url,
					recrawl: recrawl ? 1 : 0,
					refresh: refresh ? 1 : 0,
				});

				/*
				 * Server commits three coarse stages for the comprehensive path —
				 * `comprehensive-fetching` (written by the dispatcher in save-link-work
				 * before this Lambda is even invoked), `comprehensive-extracting`
				 * (Tesseract fan-out), and `comprehensive-cleaning` (LLM cleanup +
				 * diff review). The extractor signals the active stage on each
				 * onProgress call; we latch a stage write whenever the value
				 * changes. Falling back to `comprehensive-extracting` when the
				 * extractor omits a stage preserves the prior behaviour for any
				 * provider that hasn't been updated. Per-part progress
				 * (partCurrent/partTotal) is routed through a throttle so the OCR
				 * fan-out's chunk-completion firehose collapses to ~1 DDB write per
				 * `progressIntervalMs`, matching the UI's 3 s poll cadence.
				 */
				let latchedStage: "comprehensive-extracting" | "comprehensive-cleaning" | undefined;
				const progressThrottle = initProgressThrottle({
					markCrawlProgress,
					intervalMs: progressIntervalMs,
					now: () => Date.now(),
					logger,
				});
				const crawlResult = await comprehensiveCrawl({
					url,
					onProgress: ({ partIndex, partCount, stage }) => {
						const effectiveStage = stage ?? "comprehensive-extracting";
						if (effectiveStage !== latchedStage) {
							latchedStage = effectiveStage;
							markCrawlStage({ url, stage: effectiveStage }).catch((error: unknown) => {
								logger.warn(`${logPrefix} ${effectiveStage} stage write failed`, {
									url,
									error: String(error),
								});
							});
						}
						progressThrottle.report({ url, partCurrent: partIndex, partTotal: partCount });
					},
				});
				await progressThrottle.flush({ url });

				if (crawlResult.status === "unsupported") {
					// Comprehensive saw the body and confirmed it cannot be extracted
					// (non-PDF body, PDF too large, OCR returned nothing, …). Flip the
					// row terminal here — no further dispatch.
					logParseError({ url, reason: `crawl-unsupported: ${crawlResult.reason}` });
					await transitionAndPersist(markCrawlUnsupported, {
						url,
						input: {
							reason: { kind: "non-html-content", contentType: crawlResult.reason },
						},
					});
					await emitTier1Failure(url);
					logger.info(`${logPrefix} crawl unsupported — terminal`, { url });
					continue;
				}

				if (crawlResult.status !== "fetched") {
					const reason = `crawl-${crawlResult.status}`;
					logParseError({ url, reason });
					await emitTier1Failure(url);
					throw new Error(`crawl failed for ${url}: ${reason}`);
				}

				const finalized = await finalizeArticle({
					url,
					html: crawlResult.html,
					preFetchedThumbnail: crawlResult.thumbnailImage,
				});
				if (!finalized.ok) {
					logParseError({ url, reason: finalized.reason });
					await transitionAndPersist(markCrawlFailed, {
						url,
						input: {
							reason: { kind: "parse-error", detail: finalized.reason },
						},
					});
					await emitTier1Failure(url);
					throw new Error(`crawl failed for ${url}: ${finalized.reason}`);
				}

				await putTierSource({
					url,
					tier: "tier-1",
					html: finalized.article.html,
					metadata: finalized.article.metadata,
				});
				await markCrawlStage({ url, stage: "crawl-content-uploaded" });

				const contentFetchedAt = now().toISOString();

				/* Refresh chain carries freshness directly on the
				 * RefreshContentExtractedEvent and the downstream
				 * refresh-content-extracted handler sets it via the refreshContent
				 * aggregate transition, mirroring the existing in-place refresh
				 * Lambda. Save / recrawl chains have no aggregate write that
				 * persists etag/lastModified, so they still go through the
				 * UpdateFetchTimestampCommand → update-fetch-timestamp Lambda. */
				if (!refresh) {
					await updateFetchTimestamp({
						url,
						contentFetchedAt,
						etag: crawlResult.etag,
						lastModified: crawlResult.lastModified,
					});
				}

				const successSnapshot = await readTierSnapshot({ url });
				logCrawlOutcome({
					url,
					thisTier: "tier-1",
					thisTierStatus: "success",
					otherTierStatus: successSnapshot.tier0Status,
					pickedTier: successSnapshot.pickedTier,
				});

				if (refresh) {
					// Stale-check refresh chain: the refresh-content-extracted Lambda
					// runs the selector across all tier sources, picks a winner, and
					// drives the refreshContent transition (which sets freshness +
					// canonical) — mirrors the in-place refresh flow shape.
					await publishEvent(RefreshContentExtractedEvent, {
						url,
						etag: crawlResult.etag,
						lastModified: crawlResult.lastModified,
						contentFetchedAt,
					});
					logger.info(`${logPrefix} emitted RefreshContentExtractedEvent`, { url });
				} else if (recrawl) {
					// Recrawl chain runs a clone of the selector that ALWAYS dispatches
					// generate-summary regardless of canonical change. Emit the recrawl-
					// specific event so admin recrawls of PDFs preserve that semantics.
					await publishEvent(RecrawlContentExtractedEvent, { url });
					logger.info(`${logPrefix} emitted RecrawlContentExtractedEvent`, { url });
				} else {
					await publishEvent(TierContentExtractedEvent, { url, tier: "tier-1", userId });
					logger.info(`${logPrefix} emitted TierContentExtractedEvent`, { url, tier: "tier-1" });
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
