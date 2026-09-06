import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { UserId } from "@packages/domain/user";
import { UserIdSchema } from "@packages/domain/user";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import type { AllocateSavedAt } from "@packages/provider-contracts/article-store";
import type { RecordInboxArticleQueued } from "@packages/provider-contracts/onboarding-signals";
import { SaveProvenanceSchema } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import {
	LinkQueuedEvent,
	QueueEntryCreatedEvent,
	SubmitLinkCommand,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import { initSaveArticleAtReadlistTop, initSaveArticleFromUrl, type SaveArticleFromUrlDependencies } from "@packages/save-article";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { AdoptCanonicalIdentity } from "../save-link/adopt-canonical-identity";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import { initSaveLinkWork, logRecordFailure } from "../save-link/save-link-work";
import { crawlFailureReasonForError } from "../save-link/crawl-failure-reason-for-error";

export function initSubmitLinkCommandHandler(deps: {
	validateSaveableUrl: ValidateSaveableUrl;
	saveArticle: SaveArticleFromUrlDependencies["saveArticle"];
	updateArticleStatus: SaveArticleFromUrlDependencies["updateArticleStatus"];
	markCrawlPending: SaveArticleFromUrlDependencies["markCrawlPending"];
	markSummaryPending: SaveArticleFromUrlDependencies["markSummaryPending"];
	publishUpdateFetchTimestamp: SaveArticleFromUrlDependencies["publishUpdateFetchTimestamp"];
	refreshArticleIfStale: SaveArticleFromUrlDependencies["refreshArticleIfStale"];
	allocateSavedAt: AllocateSavedAt;
	recordInboxArticleQueued: RecordInboxArticleQueued;
	resolveCanonicalIdentity: SaveArticleFromUrlDependencies["resolveCanonicalIdentity"];
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
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;
	const logPrefix = "[SubmitLinkCommand]";

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
	});

	async function crawlTier1(link: { url: string; userId: UserId }): Promise<void> {
		const result = await saveLinkWork(link.url, { userId: link.userId });
		if (result === "tier-1-deferred") {
			logger.info(`${logPrefix} tier-1 deferred to comprehensive Lambda`, { url: link.url });
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
			tier: "tier-1",
			userId: link.userId,
			extractedAt: deps.now().toISOString(),
		});
		logger.info(`${logPrefix} emitted TierContentExtractedEvent`, {
			url: link.url,
			tier: "tier-1",
		});
	}

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = SubmitLinkCommand.detailSchema.parse(envelope.detail);
				assert(
					detail.rawHtml === undefined,
					`${logPrefix} rawHtml (tier-0) submissions have no handler yet`,
				);
				assert("userId" in detail, `${logPrefix} anonymous submissions have no handler yet`);
				const userId = UserIdSchema.parse(detail.userId);
				const provenance = SaveProvenanceSchema.parse(detail.provenance);

				const validation = deps.validateSaveableUrl(detail.url);
				assert(
					validation.status === "SUCCESS",
					`${logPrefix} url is not saveable: ${detail.url}`,
				);

				const enrichment: Array<{ url: string; userId: UserId }> = [];
				const saveArticleFromUrl = initSaveArticleFromUrl({
					saveArticle: deps.saveArticle,
					updateArticleStatus: deps.updateArticleStatus,
					markCrawlPending: deps.markCrawlPending,
					markSummaryPending: deps.markSummaryPending,
					publishUpdateFetchTimestamp: deps.publishUpdateFetchTimestamp,
					refreshArticleIfStale: deps.refreshArticleIfStale,
					resolveCanonicalIdentity: deps.resolveCanonicalIdentity,
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
				const freshness = await deps.refreshArticleIfStale({ url: validation.url });
				await saveArticleAtReadlistTop({ userId, url: validation.url, freshness, provenance });

				if (provenance.kind === "email") {
					try {
						await deps.recordInboxArticleQueued({ userId });
					} catch (error) {
						logger.warn(`${logPrefix} inbox onboarding stamp failed — continuing`, {
							url: validation.url,
							error: String(error),
						});
					}
				}

				for (const link of enrichment) {
					try {
						await crawlTier1(link);
					} catch (error) {
						logger.warn(`${logPrefix} tier-1 crawl failed — terminalising in-process`, {
							url: link.url,
							error: String(error),
						});
						const receiveCount = Number(record.attributes.ApproximateReceiveCount);
						await deps.transitionAndPersist(markCrawlExhausted, {
							url: link.url,
							input: {
								reason: crawlFailureReasonForError({ error, receiveCount }),
								receiveCount,
							},
						});
					}
				}
			} catch (error) {
				logRecordFailure({ logger, logPrefix, record, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
