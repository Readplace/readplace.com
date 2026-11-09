import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { type DeepseekCallFailedLogLine, describeAiProviderError, deepseekCallFailedLogLine } from "@packages/ai-message";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type {
	FindRelatedArticles,
	FindRelatedTargetArticle,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
} from "@packages/provider-contracts/related-articles";
import { ComputeRelatedPassesCommand } from "./index";
import { COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT } from "./max-receive-count";
import { MetadataNotReadyError, initNextReadComputation } from "./next-read-computation";
import type { GatherRelatedCandidatePools } from "./related-articles-candidates";
import type { RecommendationTrigger, SelectRelatedArticles } from "./related-articles-selector";

interface ComputeRelatedArticlesHandlerDeps {
	findRelatedArticles: FindRelatedArticles;
	findRelatedTargetArticle: FindRelatedTargetArticle;
	gatherRelatedCandidatePools: GatherRelatedCandidatePools;
	selectRelatedArticles: SelectRelatedArticles;
	markRelatedArticlesReady: MarkRelatedArticlesReady;
	markRelatedArticlesSkipped: MarkRelatedArticlesSkipped;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
	deepseekCallFailedLog: Logger.Typed<DeepseekCallFailedLogLine>;
}

const TRIGGER: RecommendationTrigger = "reader-request";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initComputeRelatedArticlesHandler(
	deps: ComputeRelatedArticlesHandlerDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	const {
		findRelatedArticles,
		findRelatedTargetArticle,
		gatherRelatedCandidatePools,
		selectRelatedArticles,
		markRelatedArticlesReady,
		markRelatedArticlesSkipped,
		publishEvent,
		now,
		logger,
		deepseekCallFailedLog,
	} = deps;
	const { skipNextRead, computeNextRead } = initNextReadComputation({
		gatherRelatedCandidatePools,
		selectRelatedArticles,
		markRelatedArticlesReady,
		markRelatedArticlesSkipped,
		publishEvent,
		now,
		logger,
	});

	return initSqsRecordHandler({
		definition: ComputeRelatedPassesCommand,
		logger,
		failure: {
			report: ({ record, error }) => {
				if (error instanceof MetadataNotReadyError) {
					logger.info(
						"[ComputeRelatedArticles] waiting for crawl metadata; redelivery scheduled",
						{
							url: error.url,
							messageId: record.messageId,
							receiveCount: record.receiveCount,
							crawlStatus: error.crawlStatus,
						},
					);
					return;
				}
				logger.error("[ComputeRelatedArticles] record failed", {
					messageId: record.messageId,
					error,
				});
				const failure = describeAiProviderError(error);
				if (failure.kind !== "unknown") {
					deepseekCallFailedLog.error(deepseekCallFailedLogLine({
						feature: "compute-related-articles",
						failure,
						receiveCount: record.receiveCount,
						messageId: record.messageId,
						ids: {},
					}));
				}
			},
		},
		malformed: { policy: "retry" },
		handle: async (entry, record) => {
			const { userId } = entry;
			const { receiveCount } = record;

			const existing = await findRelatedArticles({ userId, url: entry.url });
			if (existing.status !== "pending") {
				logger.info("[ComputeRelatedArticles] cache hit", {
					url: entry.url,
					status: existing.status,
				});
				return;
			}

			const save = { userId, url: entry.url, receiveCount, messageId: record.messageId, trigger: TRIGGER };

			const lookup = await findRelatedTargetArticle(entry.url);
			if (lookup.state === "purged") {
				await skipNextRead({ save, reason: "the article was purged before its related links were computed" });
				return;
			}
			if (lookup.state === "not-an-article") {
				await skipNextRead({ save, reason: "not an article host" });
				return;
			}
			if (lookup.state === "absent") {
				if (receiveCount < COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT) {
					throw new MetadataNotReadyError({ url: entry.url, crawlStatus: undefined });
				}
				await skipNextRead({ save, reason: "article row gone after the wait" });
				return;
			}
			const target = lookup.article;
			if (target.crawlStatus === "pending") {
				if (receiveCount < COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT) {
					throw new MetadataNotReadyError({ url: entry.url, crawlStatus: "pending" });
				}
				await skipNextRead({ save, reason: "crawl still pending after the wait", details: { crawlStatus: "pending" } });
				return;
			}
			const { crawlStatus } = target;
			if (target.hasStubMetadata) {
				if (crawlStatus === "failed" && receiveCount < COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT) {
					throw new MetadataNotReadyError({ url: entry.url, crawlStatus });
				}
				await skipNextRead({ save, reason: "crawl produced no metadata to compare", details: { crawlStatus } });
				return;
			}

			await computeNextRead({ save, target });
		},
	});
}
