import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { hasEnoughSavesForNextRead } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	FindRelatedArticles,
	FindRelatedTargetArticle,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
	RelatedTargetArticle,
} from "@packages/provider-contracts/related-articles";
import { QueueEntryCreatedEvent, RelatedArticlesComputedEvent } from "./index";
import { COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT } from "./max-receive-count";
import type { GatherRelatedCandidatePools } from "./related-articles-candidates";
import type { SelectRelatedArticles } from "./related-articles-selector";

interface ComputeRelatedArticlesHandlerDeps {
	findRelatedArticles: FindRelatedArticles;
	findRelatedTargetArticle: FindRelatedTargetArticle;
	gatherRelatedCandidatePools: GatherRelatedCandidatePools;
	selectRelatedArticles: SelectRelatedArticles;
	markRelatedArticlesReady: MarkRelatedArticlesReady;
	markRelatedArticlesSkipped: MarkRelatedArticlesSkipped;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
}

class MetadataNotReadyError extends Error {
	readonly url: string;
	readonly crawlStatus: RelatedTargetArticle["crawlStatus"];
	constructor(params: { url: string; crawlStatus: RelatedTargetArticle["crawlStatus"] }) {
		super(`[ComputeRelatedArticles] article metadata not ready for ${params.url}`);
		this.url = params.url;
		this.crawlStatus = params.crawlStatus;
	}
}

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
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			const receiveCount = Number(record.attributes.ApproximateReceiveCount);
			try {
				const envelope = JSON.parse(record.body);
				const entry = QueueEntryCreatedEvent.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(entry.userId);

				const existing = await findRelatedArticles({ userId, url: entry.url });
				if (existing.status !== "pending") {
					logger.info("[ComputeRelatedArticles] cache hit", {
						url: entry.url,
						status: existing.status,
					});
					continue;
				}

				const skip = async (reason: string, details?: {
					crawlStatus: RelatedTargetArticle["crawlStatus"];
					bestScore?: number;
					candidateCount?: number;
					hasSummary?: boolean;
				}): Promise<void> => {
					const outcome = await markRelatedArticlesSkipped({
						userId,
						url: entry.url,
						at: now(),
					});
					if (outcome === "superseded") {
						logger.info("[ComputeRelatedArticles] superseded", { url: entry.url });
						return;
					}
					await publishEvent(RelatedArticlesComputedEvent, {
						url: entry.url,
						userId,
						outcome: "skipped",
						relatedCount: 0,
						inputTokens: 0,
						outputTokens: 0,
					});
					logger.info("[ComputeRelatedArticles] skipped", {
						url: entry.url,
						reason,
						receiveCount,
						...details,
					});
				};

				const lookup = await findRelatedTargetArticle(entry.url);
				if (lookup.state === "purged") {
					await skip("the article was purged before its related links were computed");
					continue;
				}
				if (lookup.state === "not-an-article") {
					await skip("not an article host");
					continue;
				}
				if (lookup.state === "absent") {
					throw new MetadataNotReadyError({ url: entry.url, crawlStatus: undefined });
				}
				const target = lookup.article;
				if (target.crawlStatus === "pending") {
					throw new MetadataNotReadyError({ url: entry.url, crawlStatus: "pending" });
				}
				const { crawlStatus } = target;
				if (target.hasStubMetadata) {
					if (crawlStatus === "failed" && receiveCount < COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT) {
						throw new MetadataNotReadyError({ url: entry.url, crawlStatus });
					}
					await skip("crawl produced no metadata to compare", { crawlStatus });
					continue;
				}

				const pools = await gatherRelatedCandidatePools({
					userId,
					excludeUrl: entry.url,
				});
				const candidateCount =
					pools.unreadCandidates.length + pools.readCandidates.length;
				if (!hasEnoughSavesForNextRead(candidateCount)) {
					if (pools.awaitingCrawl > 0) throw new MetadataNotReadyError({ url: entry.url, crawlStatus });
					await skip("not enough saves to compare against", { crawlStatus });
					continue;
				}

				const result = await selectRelatedArticles({
					target,
					unreadCandidates: pools.unreadCandidates,
					readCandidates: pools.readCandidates,
				});
				if (result.kind === "shared-boilerplate") {
					await skip("the saved text is a block page shared across sites", { crawlStatus });
					continue;
				}
				if (result.kind === "no-shared-words") {
					await skip("no earlier save shares the saved article's words", {
						crawlStatus,
						bestScore: result.bestScore,
						candidateCount: result.candidateCount,
						hasSummary: target.hasSummary,
					});
					continue;
				}
				if (result.kind !== "ready") {
					throw new Error(
						`[ComputeRelatedArticles] ${result.kind satisfies "no-text-block"} for ${entry.url}`,
					);
				}

				const outcome = await markRelatedArticlesReady({
					userId,
					url: entry.url,
					relatedArticles: result.related,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
					at: now(),
				});
				if (outcome === "superseded") {
					logger.info("[ComputeRelatedArticles] superseded", { url: entry.url });
					continue;
				}
				await publishEvent(RelatedArticlesComputedEvent, {
					url: entry.url,
					userId,
					outcome: "ready",
					relatedCount: result.related.length,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
				});
				logger.info("[ComputeRelatedArticles] completed", {
					sampleCount: result.samples.length,
					samples: result.samples,
					agreement: result.agreement,
					url: entry.url,
					relatedCount: result.related.length,
					droppedNoSharedWord: result.droppedNoSharedWord,
					droppedReasonNotAboutPick: result.droppedReasonNotAboutPick,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
					cacheHitInputTokens: result.cacheHitInputTokens ?? "unknown",
					cacheMissInputTokens: result.cacheMissInputTokens ?? "unknown",
				});
			} catch (error) {
				if (error instanceof MetadataNotReadyError) {
					logger.info(
						"[ComputeRelatedArticles] waiting for crawl metadata; redelivery scheduled",
						{
							url: error.url,
							messageId: record.messageId,
							receiveCount,
							crawlStatus: error.crawlStatus,
						},
					);
				} else {
					logger.error("[ComputeRelatedArticles] record failed", {
						messageId: record.messageId,
						error,
					});
				}
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
