import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CrawlArticle } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	SaveLinkCommand,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type {
	MarkCrawlFailed,
	MarkCrawlStage,
	MarkCrawlUnsupported,
} from "../crawl-article-state/article-crawl.types";
import type { MarkSummarySkipped } from "../generate-summary/article-summary.types";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia } from "./download-media";
import type { PutImageObject } from "./s3-put-image-object";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { initSaveLinkWork, type ProcessContent } from "./save-link-work";
import type { PutTierSource } from "../select-content/put-tier-source";

export function initSaveLinkCommandHandler(deps: {
	crawlArticle: CrawlArticle;
	parseHtml: ParseHtml;
	putTierSource: PutTierSource;
	putImageObject: PutImageObject;
	updateFetchTimestamp: UpdateFetchTimestamp;
	markCrawlFailed: MarkCrawlFailed;
	markCrawlUnsupported: MarkCrawlUnsupported;
	markCrawlStage: MarkCrawlStage;
	markSummarySkipped: MarkSummarySkipped;
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
	const { publishEvent, logger } = deps;

	const { saveLinkWork } = initSaveLinkWork({
		crawlArticle: deps.crawlArticle,
		parseHtml: deps.parseHtml,
		putTierSource: deps.putTierSource,
		putImageObject: deps.putImageObject,
		updateFetchTimestamp: deps.updateFetchTimestamp,
		markCrawlFailed: deps.markCrawlFailed,
		markCrawlUnsupported: deps.markCrawlUnsupported,
		markCrawlStage: deps.markCrawlStage,
		markSummarySkipped: deps.markSummarySkipped,
		downloadMedia: deps.downloadMedia,
		processContent: deps.processContent,
		imagesCdnBaseUrl: deps.imagesCdnBaseUrl,
		now: deps.now,
		logger,
		logParseError: deps.logParseError,
		logCrawlOutcome: deps.logCrawlOutcome,
		readTierSnapshot: deps.readTierSnapshot,
		logPrefix: "[SaveLinkCommand]",
	});

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SaveLinkCommand.detailSchema.parse(envelope.detail);

				const result = await saveLinkWork(detail.url);
				if (result === "unsupported") {
					logger.info("[SaveLinkCommand] crawl unsupported — terminal", {
						url: detail.url,
					});
					continue;
				}

				await publishEvent({
					source: TierContentExtractedEvent.source,
					detailType: TierContentExtractedEvent.detailType,
					detail: JSON.stringify({
						url: detail.url,
						tier: "tier-1",
						userId: detail.userId,
					}),
				});
				logger.info("[SaveLinkCommand] emitted TierContentExtractedEvent", {
					url: detail.url,
					tier: "tier-1",
				});
			} catch (error) {
				logger.error("[SaveLinkCommand] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
