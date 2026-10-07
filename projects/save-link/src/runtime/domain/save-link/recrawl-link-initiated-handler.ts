import { initCrawlSaveCandidates, type SaveCandidates } from "./crawl-save-candidates";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import {
	RecrawlLinkInitiatedEvent,
	RecrawlContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { initSaveLinkWork, logRecordFailure } from "./save-link-work";
import type { PrepareArticleIdentity, VerifyWrapperSource } from "@packages/save-article";
import assert from "node:assert";
import { initCrawlArchiveCapture } from "./crawl-archive-capture";
import type { AdoptCanonicalIdentity } from "./adopt-canonical-identity";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";

export function initRecrawlLinkInitiatedHandler(deps: {
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
	prepareArticleIdentity: PrepareArticleIdentity;
	findContentSourceUrl: (url: string) => Promise<string | undefined>;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;
	const logPrefix = "[RecrawlLinkInitiated]";

	const { saveLinkWork } = initSaveLinkWork({
		crawlAndFinalizeArticle: deps.crawlAndFinalizeArticle,
		emitSimpleCrawlUnsupported: deps.emitSimpleCrawlUnsupported,
		putTierSource: deps.putTierSource,
		updateFetchTimestamp: deps.updateFetchTimestamp,
		transitionAndPersist: deps.transitionAndPersist,
		markCrawlStage: deps.markCrawlStage,
		adoptCanonicalIdentity: deps.adoptCanonicalIdentity,
		now: deps.now,
		logger,
		logParseError: deps.logParseError,
		logCrawlOutcome: deps.logCrawlOutcome,
		readTierSnapshot: deps.readTierSnapshot,
		logPrefix,
		resolveOriginalUrl: deps.resolveOriginalUrl,
	});

	const crawlArchiveCapture = initCrawlArchiveCapture({
		crawlAndFinalizeArticle: deps.crawlAndFinalizeArticle,
		putTierSource: deps.putTierSource,
		readTierSnapshot: deps.readTierSnapshot,
		logCrawlOutcome: deps.logCrawlOutcome,
		publishEvent,
		logger,
		now: deps.now,
		verifyWrapperSource: deps.verifyWrapperSource,
	});

	const crawlSaveCandidates = initCrawlSaveCandidates({ crawlArchiveCapture, saveLinkWork, emitSimpleCrawlUnsupported: deps.emitSimpleCrawlUnsupported });

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RecrawlLinkInitiatedEvent.detailSchema.parse(envelope.detail);
				const { saveAttemptId } = detail;

				logger.info("[RecrawlLinkInitiated] processing", { url: detail.url });
				const identity = await deps.prepareArticleIdentity(detail.url);
				assert(identity.status === "resolved", "recrawl original identity is unresolved");

				const captureUrl = await deps.findContentSourceUrl(detail.url);
				let extracted: SaveCandidates;
				if (captureUrl !== undefined) {
					extracted = await crawlSaveCandidates({ url: detail.url, captureUrl, saveAttemptId, recrawl: true, sourceOriginalUrl: identity.sourceOriginalUrl });
				} else {
					const result = await saveLinkWork(detail.url, { recrawl: true, saveAttemptId });
					if (typeof result !== "object") continue;
					extracted = { candidates: [result.candidate], liveAttempt: { outcome: "body" } };
				}

				await publishEvent(RecrawlContentExtractedEvent, {
					url: detail.url,
					saveAttemptId,
					...extracted,
					extractedAt: deps.now().toISOString(),
				});
				logger.info("[RecrawlLinkInitiated] emitted RecrawlContentExtractedEvent", {
					url: detail.url,
				});
			} catch (error) {
				logRecordFailure({ logger, logPrefix, record, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
