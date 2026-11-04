import assert from "node:assert";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import {
	SaveAnonymousLinkCommand,
	TierContentExtractedEvent,
} from "@packages/infra-components";
import type { MarkCrawlStage } from "../../domain/crawl-article-state/crawl-stage.types";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { ClassifiedCrawlError, initSaveLinkWork, logRecordFailure } from "./save-link-work";
import { initCrawlArchiveCapture } from "./crawl-archive-capture";
import { initCrawlSaveCandidates } from "./crawl-save-candidates";
import type { PrepareArticleIdentity, VerifyWrapperSource } from "@packages/save-article";
import type { AdoptCanonicalIdentity } from "./adopt-canonical-identity";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import type { PutTierSource } from "@packages/tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";

export function initSaveAnonymousLinkCommandHandler(deps: {
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	isSiteRuleUrl: (url: string) => boolean;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
	prepareArticleIdentity: PrepareArticleIdentity;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;
	const logPrefix = "[SaveAnonymousLinkCommand]";

	const { saveLinkWork } = initSaveLinkWork({
		crawlAndFinalizeArticle: deps.crawlAndFinalizeArticle,
		emitSimpleCrawlUnsupported: deps.emitSimpleCrawlUnsupported,
		putTierSource: deps.putTierSource,
		publishEvent,
		updateFetchTimestamp: deps.updateFetchTimestamp,
		transitionAndPersist: deps.transitionAndPersist,
		markCrawlStage: deps.markCrawlStage,
		adoptCanonicalIdentity: deps.adoptCanonicalIdentity,
		isSiteRuleUrl: deps.isSiteRuleUrl,
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

	return initSqsRecordHandler({
		definition: SaveAnonymousLinkCommand,
		logger,
		failure: { report: ({ record, error }) => logRecordFailure({ logger, logPrefix, record, error }) },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { saveAttemptId } = detail;
			const identity = await deps.prepareArticleIdentity(detail.url);
			assert(identity.status === "resolved", "queued article original is unresolved");
			try {
				const captureUrl = detail.captureUrl ?? identity.contentSourceUrl;

				if (captureUrl !== undefined) {
					const result = await crawlSaveCandidates({
						url: detail.url,
						captureUrl,
						saveAttemptId,
						sourceOriginalUrl: detail.sourceOriginalUrl ?? identity.sourceOriginalUrl,
					});
					if ("deferredTo" in result) {
						logger.info("[SaveAnonymousLinkCommand] tier-1 deferred to comprehensive Lambda", { url: detail.url, carriedCandidates: result.carriedCandidates });
						return;
					}
					await publishEvent(TierContentExtractedEvent, {
						url: detail.url,
						saveAttemptId,
						...result,
						extractedAt: deps.now().toISOString(),
					});
					return;
				}

				logger.info("[SaveAnonymousLinkCommand] processing", { url: detail.url });

				const result = await saveLinkWork(detail.url, { saveAttemptId });
				if (typeof result === "object" && "deferred" in result) {
					logger.info("[SaveAnonymousLinkCommand] tier-1 deferred to comprehensive Lambda", {
						url: detail.url,
						unsupportedReason: result.deferred,
					});
					return;
				}
				if (result === "tier-1-terminal") {
					logger.info("[SaveAnonymousLinkCommand] tier-1 terminal — origin no longer serves the page", {
						url: detail.url,
					});
					return;
				}

				await publishEvent(TierContentExtractedEvent, {
					url: detail.url,
					saveAttemptId,
					candidates: [result.candidate],
					extractedAt: deps.now().toISOString(),
				});
				logger.info("[SaveAnonymousLinkCommand] emitted TierContentExtractedEvent", {
					url: detail.url,
					tier: "tier-1",
				});
			} catch (error) {
				if (!(error instanceof ClassifiedCrawlError)) throw error;
				logger.warn("[SaveAnonymousLinkCommand] crawl failed — terminalising in-process", {
					url: detail.url,
					error: String(error),
				});
				await deps.transitionAndPersist(markCrawlExhausted, {
					url: detail.url,
					input: {
						reason: error.crawlFailureReason,
						receiveCount: record.receiveCount,
					},
				});
			}
		},
	});
}
