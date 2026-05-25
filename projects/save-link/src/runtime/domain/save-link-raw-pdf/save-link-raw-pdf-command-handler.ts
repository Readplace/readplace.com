import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ExtractPdf } from "@packages/crawl-article";
import { parsePdfFromBuffer } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	markCrawlFailed,
	markCrawlUnsupported,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import {
	SaveLinkRawPdfCommand,
	TierContentExtractedEvent,
	type LogCrawlOutcome,
	type LogParseError,
} from "@packages/hutch-infra-components";
import type { ParseHtml } from "@packages/article-parser";
import { ArticleResourceUniqueId } from "../save-link/article-resource-unique-id";
import { estimatedReadTimeFromWordCount } from "../save-link/estimated-read-time";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { ReadPendingPdf } from "../../providers/article-store/read-pending-pdf";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { DownloadMedia } from "../save-link/download-media";
import type { ProcessContent } from "../save-link/save-link-work";

const TIER = "tier-0";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveLinkRawPdfCommandHandler(deps: {
	readPendingPdf: ReadPendingPdf;
	extractPdf: ExtractPdf;
	parseHtml: ParseHtml;
	downloadMedia: DownloadMedia;
	processContent: ProcessContent;
	putTierSource: PutTierSource;
	publishEvent: PublishEvent;
	transitionAndPersist: TransitionAndPersist;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		readPendingPdf,
		extractPdf,
		parseHtml,
		downloadMedia,
		processContent,
		putTierSource,
		publishEvent,
		transitionAndPersist,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
	} = deps;

	const logPrefix = "[SaveLinkRawPdfCommand]";

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SaveLinkRawPdfCommand.detailSchema.parse(envelope.detail);

				const bytes = await readPendingPdf(detail.url);
				const crawlResult = await parsePdfFromBuffer({
					buffer: bytes,
					/* The buffer came from the user's browser, not from a server fetch —
					 * there is no Response object and therefore no ETag/Last-Modified
					 * headers to forward. parsePdfFromBuffer accepts `undefined` and drops
					 * those fields from the result accordingly. */
					response: undefined,
					url: detail.url,
					extractPdf,
					logError: (msg, err) => logger.error(msg, { error: err }),
				});

				if (crawlResult.status === "unsupported") {
					logParseError({ url: detail.url, reason: `pdf-unsupported: ${crawlResult.reason}` });
					await transitionAndPersist(markCrawlUnsupported, {
						url: detail.url,
						input: {
							reason: { kind: "non-html-content", contentType: crawlResult.reason },
						},
					});
					const snapshot = await readTierSnapshot({ url: detail.url });
					logCrawlOutcome({
						url: detail.url,
						thisTier: TIER,
						thisTierStatus: "failed",
						otherTierStatus: snapshot.tier1Status,
						pickedTier: snapshot.pickedTier,
					});
					logger.info(`${logPrefix} unsupported — terminal`, { url: detail.url });
					continue;
				}

				/* parsePdfFromBuffer only returns "fetched" or "unsupported" — the type
				 * union admits "failed"/"not-modified" but neither is reachable from
				 * the buffer path. Assert the invariant so the parseHtml call below
				 * can rely on crawlResult.html without an untestable branch. */
				assert(
					crawlResult.status === "fetched",
					`${logPrefix} unexpected crawl status ${crawlResult.status}`,
				);

				const parseResult = parseHtml({ url: detail.url, html: crawlResult.html });
				if (!parseResult.ok) {
					logParseError({ url: detail.url, reason: parseResult.reason });
					const snapshot = await readTierSnapshot({ url: detail.url });
					logCrawlOutcome({
						url: detail.url,
						thisTier: TIER,
						thisTierStatus: "failed",
						otherTierStatus: snapshot.tier1Status,
						pickedTier: snapshot.pickedTier,
					});
					await transitionAndPersist(markCrawlFailed, {
						url: detail.url,
						input: {
							reason: { kind: "parse-error", detail: parseResult.reason },
						},
					});
					throw new Error(
						`${logPrefix} parse failed for ${detail.url}: ${parseResult.reason}`,
					);
				}

				const articleResourceUniqueId = ArticleResourceUniqueId.parse(detail.url);
				const media = await downloadMedia({
					html: parseResult.article.content,
					articleUrl: detail.url,
					articleResourceUniqueId,
				});
				const processedHtml = await processContent({
					html: parseResult.article.content,
					media,
				});

				await putTierSource({
					url: detail.url,
					tier: TIER,
					html: processedHtml,
					metadata: {
						title: parseResult.article.title,
						siteName: parseResult.article.siteName,
						excerpt: parseResult.article.excerpt,
						wordCount: parseResult.article.wordCount,
						estimatedReadTime: estimatedReadTimeFromWordCount(parseResult.article.wordCount),
						imageUrl: parseResult.article.imageUrl,
					},
				});

				const snapshot = await readTierSnapshot({ url: detail.url });
				logCrawlOutcome({
					url: detail.url,
					thisTier: TIER,
					thisTierStatus: "success",
					otherTierStatus: snapshot.tier1Status,
					pickedTier: snapshot.pickedTier,
				});

				await publishEvent({
					source: TierContentExtractedEvent.source,
					detailType: TierContentExtractedEvent.detailType,
					detail: JSON.stringify({
						url: detail.url,
						tier: TIER,
						userId: detail.userId,
					}),
				});

				logger.info(`${logPrefix} tier-0 source written`, { url: detail.url });
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
