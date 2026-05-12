import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CrawlArticle } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import {
	RecrawlLinkInitiatedEvent,
	RecrawlContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type { MarkCrawlStage } from "../crawl-article-state/article-crawl.types";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia } from "./download-media";
import type { PutImageObject } from "./s3-put-image-object";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { initSaveLinkWork, type ProcessContent } from "./save-link-work";
import type { PutTierSource } from "../select-content/put-tier-source";

export function initRecrawlLinkInitiatedHandler(deps: {
	crawlArticle: CrawlArticle;
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
	const { publishEvent, logger } = deps;

	const { saveLinkWork } = initSaveLinkWork({
		crawlArticle: deps.crawlArticle,
		parseHtml: deps.parseHtml,
		putTierSource: deps.putTierSource,
		putImageObject: deps.putImageObject,
		updateFetchTimestamp: deps.updateFetchTimestamp,
		transitionAndPersist: deps.transitionAndPersist,
		markCrawlStage: deps.markCrawlStage,
		downloadMedia: deps.downloadMedia,
		processContent: deps.processContent,
		imagesCdnBaseUrl: deps.imagesCdnBaseUrl,
		now: deps.now,
		logger,
		logParseError: deps.logParseError,
		logCrawlOutcome: deps.logCrawlOutcome,
		readTierSnapshot: deps.readTierSnapshot,
		logPrefix: "[RecrawlLinkInitiated]",
	});

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RecrawlLinkInitiatedEvent.detailSchema.parse(envelope.detail);

				logger.info("[RecrawlLinkInitiated] processing", { url: detail.url });

				const result = await saveLinkWork(detail.url);
				if (result === "unsupported") {
					logger.info("[RecrawlLinkInitiated] crawl unsupported — terminal", {
						url: detail.url,
					});
					continue;
				}

				await publishEvent({
					source: RecrawlContentExtractedEvent.source,
					detailType: RecrawlContentExtractedEvent.detailType,
					detail: JSON.stringify({ url: detail.url }),
				});
				logger.info("[RecrawlLinkInitiated] emitted RecrawlContentExtractedEvent", {
					url: detail.url,
				});
			} catch (error) {
				logger.error("[RecrawlLinkInitiated] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
