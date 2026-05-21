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
import type { ParseHtml } from "@packages/article-parser";
import type { DownloadMedia } from "../save-link/download-media";
import type { PutImageObject } from "../../providers/article-store/s3-put-image-object";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { ArticleResourceUniqueId } from "../save-link/article-resource-unique-id";
import { estimatedReadTimeFromWordCount } from "../save-link/estimated-read-time";
import { uploadThumbnail, type ProcessContent } from "../save-link/save-link-work";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initComprehensiveCrawlHandler(deps: {
	comprehensiveCrawl: ComprehensiveCrawl;
	parseHtml: ParseHtml;
	putTierSource: PutTierSource;
	putImageObject: PutImageObject;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	publishEvent: PublishEvent;
	downloadMedia: DownloadMedia;
	processContent: ProcessContent;
	imagesCdnBaseUrl: string;
	now: () => Date;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		comprehensiveCrawl,
		parseHtml,
		putTierSource,
		putImageObject,
		updateFetchTimestamp,
		transitionAndPersist,
		markCrawlStage,
		publishEvent,
		downloadMedia,
		processContent,
		imagesCdnBaseUrl,
		now,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
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
				 * Server only commits two coarse stages for the comprehensive path —
				 * `comprehensive-fetching` (written by the dispatcher in save-link-work
				 * before this Lambda is even invoked) and `comprehensive-extracting`,
				 * latched once by the first onPdfPage callback. The client smoother
				 * interpolates between the two so the reader's bar drifts upward
				 * during the multi-second extraction window without every page
				 * incurring a DynamoDB write.
				 */
				let stageLatched = false;
				const crawlResult = await comprehensiveCrawl({
					url,
					onPdfPage: ({ pageIndex }) => {
						if (pageIndex !== 1 || stageLatched) return;
						stageLatched = true;
						markCrawlStage({ url, stage: "comprehensive-extracting" }).catch((error: unknown) => {
							logger.warn(`${logPrefix} comprehensive-extracting stage write failed`, {
								url,
								error: String(error),
							});
						});
					},
				});

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

				const parseResult = parseHtml({ url, html: crawlResult.html });
				if (!parseResult.ok) {
					logParseError({ url, reason: parseResult.reason });
					await transitionAndPersist(markCrawlFailed, {
						url,
						input: {
							reason: { kind: "parse-error", detail: parseResult.reason },
						},
					});
					await emitTier1Failure(url);
					throw new Error(`crawl failed for ${url}: ${parseResult.reason}`);
				}

				const { article } = parseResult;
				await markCrawlStage({ url, stage: "crawl-parsed" });
				const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);

				const media = await downloadMedia({
					html: article.content,
					articleUrl: url,
					articleResourceUniqueId,
				});

				const html = await processContent({ html: article.content, media });

				const resolvedImageUrl = crawlResult.thumbnailImage
					? await uploadThumbnail({
							thumbnailImage: crawlResult.thumbnailImage,
							articleResourceUniqueId,
							putImageObject,
							imagesCdnBaseUrl,
						})
					: article.imageUrl;
				await markCrawlStage({ url, stage: "crawl-metadata-written" });

				await putTierSource({
					url,
					tier: "tier-1",
					html,
					metadata: {
						title: article.title,
						siteName: article.siteName,
						excerpt: article.excerpt,
						wordCount: article.wordCount,
						estimatedReadTime: estimatedReadTimeFromWordCount(article.wordCount),
						imageUrl: resolvedImageUrl,
					},
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
					await publishEvent({
						source: RefreshContentExtractedEvent.source,
						detailType: RefreshContentExtractedEvent.detailType,
						detail: JSON.stringify({
							url,
							etag: crawlResult.etag,
							lastModified: crawlResult.lastModified,
							contentFetchedAt,
						}),
					});
					logger.info(`${logPrefix} emitted RefreshContentExtractedEvent`, { url });
				} else if (recrawl) {
					// Recrawl chain runs a clone of the selector that ALWAYS dispatches
					// generate-summary regardless of canonical change. Emit the recrawl-
					// specific event so admin recrawls of PDFs preserve that semantics.
					await publishEvent({
						source: RecrawlContentExtractedEvent.source,
						detailType: RecrawlContentExtractedEvent.detailType,
						detail: JSON.stringify({ url }),
					});
					logger.info(`${logPrefix} emitted RecrawlContentExtractedEvent`, { url });
				} else {
					await publishEvent({
						source: TierContentExtractedEvent.source,
						detailType: TierContentExtractedEvent.detailType,
						detail: JSON.stringify({ url, tier: "tier-1", userId }),
					});
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
