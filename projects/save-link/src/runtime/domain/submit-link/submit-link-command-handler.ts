import assert from "node:assert";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { SaveAttemptId, ValidateSaveableUrl } from "@packages/domain/article";
import type { AllocateSavedAt } from "@packages/provider-contracts/article-store";
import type { RefreshIdentifiedArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { RecordInboxArticleQueued } from "@packages/provider-contracts/onboarding-signals";
import type { PublishLinkSaved } from "@packages/provider-contracts/events";
import { prepareNewSaveUrl, SaveProvenanceSchema } from "@packages/domain/article";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import {
	EmailOutputSavedToAllEvent,
	LinkQueuedEvent,
	LinkQueueFailedEvent,
	QueueEntryCreatedEvent,
	SubmitLinkCommand,
	TierContentExtractedEvent,
} from "@packages/infra-components";
import type { LogCrawlOutcome, LogParseError } from "@packages/infra-components";
import {
	type FileArticleIntoReadlist,
	initSaveArticleAtReadlistTop,
	initSaveArticleFromUrl,
	type SaveArticleFromUrlDependencies,
} from "@packages/save-article";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import type { MarkCrawlStage } from "../../domain/crawl-article-state/crawl-stage.types";
import type { PutTierSource } from "@packages/tier-source";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { AdoptCanonicalIdentity } from "../save-link/adopt-canonical-identity";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import { ClassifiedCrawlError, initSaveLinkWork, logRecordFailure } from "../save-link/save-link-work";
import { initCrawlArchiveCapture } from "../save-link/crawl-archive-capture";
import type { VerifyWrapperSource } from "@packages/save-article";
import { initCrawlSaveCandidates } from "../save-link/crawl-save-candidates";
import { SUBMIT_LINK_MAX_RECEIVE_COUNT } from "./max-receive-count";

export function initSubmitLinkCommandHandler(deps: {
	validateSaveableUrl: ValidateSaveableUrl;
	saveArticle: SaveArticleFromUrlDependencies["saveArticle"];
	updateArticleStatus: SaveArticleFromUrlDependencies["updateArticleStatus"];
	markCrawlPending: SaveArticleFromUrlDependencies["markCrawlPending"];
	markSummaryPending: SaveArticleFromUrlDependencies["markSummaryPending"];
	publishUpdateFetchTimestamp: SaveArticleFromUrlDependencies["publishUpdateFetchTimestamp"];
	refreshArticleIfStale: RefreshIdentifiedArticleIfStale;
	allocateSavedAt: AllocateSavedAt;
	fileArticleIntoReadlist: FileArticleIntoReadlist;
	recordInboxArticleQueued: RecordInboxArticleQueued;
	pinContentSource: SaveArticleFromUrlDependencies["pinContentSource"];
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
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;
	const logPrefix = "[SubmitLinkCommand]";

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

	async function crawlCapture(link: { url: string; userId: UserId; captureUrl: string; sourceOriginalUrl?: string; saveAttemptId: SaveAttemptId }): Promise<void> {
		const result = await crawlSaveCandidates(link);
		if ("deferredTo" in result) {
			logger.info(`${logPrefix} tier-1 deferred to comprehensive Lambda`, { url: link.url, carriedCandidates: result.carriedCandidates });
			return;
		}
		await publishEvent(TierContentExtractedEvent, {
			url: link.url,
			userId: link.userId,
			saveAttemptId: link.saveAttemptId,
			...result,
			extractedAt: deps.now().toISOString(),
		});
	}

	async function crawlTier1(link: { url: string; userId: UserId; saveAttemptId: SaveAttemptId }): Promise<void> {
		const result = await saveLinkWork(link.url, { userId: link.userId, saveAttemptId: link.saveAttemptId });
		if (typeof result === "object" && "deferred" in result) {
			logger.info(`${logPrefix} tier-1 deferred to comprehensive Lambda`, { url: link.url, unsupportedReason: result.deferred });
			return;
		}
		if (result === "tier-1-terminal") {
			logger.info(`${logPrefix} tier-1 terminal — origin no longer serves the page`, {
				url: link.url,
			});
			return;
		}
		await publishEvent(TierContentExtractedEvent, {
			url: link.url,
			userId: link.userId,
			saveAttemptId: link.saveAttemptId,
			candidates: [result.candidate],
			extractedAt: deps.now().toISOString(),
		});
		logger.info(`${logPrefix} emitted TierContentExtractedEvent`, {
			url: link.url,
			tier: "tier-1",
		});
	}

	return initSqsRecordHandler({
		definition: SubmitLinkCommand,
		logger,
		failure: { report: ({ record, error }) => logRecordFailure({ logger, logPrefix, record, error }) },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { saveAttemptId } = detail;
			assert(
				detail.rawHtml === undefined,
				`${logPrefix} rawHtml (tier-0) submissions have no handler yet`,
			);
			assert("userId" in detail, `${logPrefix} anonymous submissions have no handler yet`);
			const { userId } = detail;
			const provenance = SaveProvenanceSchema.parse(detail.provenance);
			const readlist = ReadlistSlugSchema.parse(detail.readlist);

			const validation = deps.validateSaveableUrl(detail.url);
			assert(
				validation.status === "SUCCESS",
				`${logPrefix} url is not saveable: ${detail.url}`,
			);
			const url = prepareNewSaveUrl(validation.url);

			const enrichment: Parameters<PublishLinkSaved>[0][] = [];
			const saveArticleFromUrl = initSaveArticleFromUrl({
				saveArticle: deps.saveArticle,
				updateArticleStatus: deps.updateArticleStatus,
				markCrawlPending: deps.markCrawlPending,
				markSummaryPending: deps.markSummaryPending,
				publishUpdateFetchTimestamp: deps.publishUpdateFetchTimestamp,
				pinContentSource: deps.pinContentSource,
				publishLinkSaved: async (params) => {
					enrichment.push(params);
				},
				publishLinkQueued: (params) => deps.publishEvent(LinkQueuedEvent, params),
				publishQueueEntryCreated: (params) =>
					deps.publishEvent(QueueEntryCreatedEvent, params),
			});

			const saveArticleAtReadlistTop = initSaveArticleAtReadlistTop({
				allocateSavedAt: deps.allocateSavedAt,
				saveArticleFromUrl,
			});
			const freshness = await deps.refreshArticleIfStale({ url });
			if (freshness.action === "unresolved") {
				const receiveCount = record.receiveCount;
				assert(receiveCount >= SUBMIT_LINK_MAX_RECEIVE_COUNT, "The wrapper original could not be resolved");
				logger.warn(`${logPrefix} wrapper original unresolved on the final receive — giving up the save`, { url });
				await publishEvent(LinkQueueFailedEvent, {
					url: detail.url,
					userId,
					reason: "wrapper-original-unresolved",
					receiveCount,
				});
				return;
			}
			const { saved, canonicalUrl, meteredLegs, crawlPending } = await saveArticleAtReadlistTop({
				userId,
				url,
				freshness,
				provenance,
				saveTrigger: detail.saveTrigger,
				saveAttemptId,
			});
			logger.info(`${logPrefix} saved`, {
				url: canonicalUrl,
				saveTrigger: detail.saveTrigger,
				freshness: freshness.action,
				meteredLegs,
				contentSource: freshness.identity.contentSourceUrl !== undefined,
				crawlPending,
			});
			if ("emailOutput" in detail && detail.emailOutput !== undefined) {
				await publishEvent(EmailOutputSavedToAllEvent, { userId, ...detail.emailOutput });
			}
			if (readlist !== DEFAULT_READLIST_SLUG) {
				await deps.fileArticleIntoReadlist({ userId, readlist, article: saved, provenance });
			}

			if (provenance.kind === "email") {
				try {
					await deps.recordInboxArticleQueued({ userId });
				} catch (error) {
					logger.warn(`${logPrefix} inbox onboarding stamp failed — continuing`, {
						url,
						error: String(error),
					});
				}
			}

			for (const link of enrichment) {
				try {
					if (link.captureUrl !== undefined) await crawlCapture({ ...link, captureUrl: link.captureUrl });
					else await crawlTier1(link);
				} catch (error) {
					const receiveCount = record.receiveCount;
					const classified = error instanceof ClassifiedCrawlError;
					if (!classified && receiveCount < SUBMIT_LINK_MAX_RECEIVE_COUNT) throw error;
					logger.warn(`${logPrefix} tier-1 crawl failed — terminalising in-process`, {
						url: link.url,
						error: String(error),
					});
					await deps.transitionAndPersist(markCrawlExhausted, {
						url: link.url,
						input: {
							reason: classified ? error.crawlFailureReason : { kind: "exhausted-retries", receiveCount },
							receiveCount,
						},
					});
				}
			}
		},
	});
}
