import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { SimpleCrawl } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import {
	SaveAnonymousLinkCommand,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia } from "./download-media";
import type { PutImageObject } from "../../providers/article-store/s3-put-image-object";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { initSaveLinkWork, type ProcessContent } from "./save-link-work";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";

export function initSaveAnonymousLinkCommandHandler(deps: {
	simpleCrawl: SimpleCrawl;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
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
		simpleCrawl: deps.simpleCrawl,
		emitSimpleCrawlUnsupported: deps.emitSimpleCrawlUnsupported,
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
		logPrefix: "[SaveAnonymousLinkCommand]",
	});

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SaveAnonymousLinkCommand.detailSchema.parse(envelope.detail);

				logger.info("[SaveAnonymousLinkCommand] processing", { url: detail.url });

				const result = await saveLinkWork(detail.url);
				if (result === "tier-1-deferred") {
					logger.info("[SaveAnonymousLinkCommand] tier-1 deferred to comprehensive Lambda", {
						url: detail.url,
					});
					continue;
				}

				await publishEvent({
					source: TierContentExtractedEvent.source,
					detailType: TierContentExtractedEvent.detailType,
					detail: JSON.stringify({ url: detail.url, tier: "tier-1" }),
				});
				logger.info("[SaveAnonymousLinkCommand] emitted TierContentExtractedEvent", {
					url: detail.url,
					tier: "tier-1",
				});
			} catch (error) {
				logger.error("[SaveAnonymousLinkCommand] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
