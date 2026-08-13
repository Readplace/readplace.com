import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	FindRelatedArticles,
	FindRelatedTargetArticle,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
} from "@packages/provider-contracts/related-articles";
import { QueueEntryCreatedEvent, RelatedArticlesComputedEvent } from "./index";
import type { GatherRelatedCandidatePools } from "./related-articles-candidates";
import { RELATED_CANDIDATES_MIN } from "./related-articles-limits";
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
	constructor(url: string) {
		super(`[ComputeRelatedArticles] article metadata not ready for ${url}`);
		this.url = url;
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

				const skip = async (reason: string): Promise<void> => {
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
					});
				};

				const target = await findRelatedTargetArticle(entry.url);
				if (!target || target.crawlStatus === "pending") {
					throw new MetadataNotReadyError(entry.url);
				}
				if (target.hasStubMetadata) {
					await skip("crawl produced no metadata to compare");
					continue;
				}

				const pools = await gatherRelatedCandidatePools({
					userId,
					excludeUrl: entry.url,
				});
				const candidateCount =
					pools.unreadCandidates.length + pools.readCandidates.length;
				if (candidateCount < RELATED_CANDIDATES_MIN) {
					if (pools.awaitingCrawl > 0) throw new MetadataNotReadyError(entry.url);
					await skip("not enough saves to compare against");
					continue;
				}

				const result = await selectRelatedArticles({
					target,
					unreadCandidates: pools.unreadCandidates,
					readCandidates: pools.readCandidates,
				});
				if (result.kind === "shared-boilerplate") {
					await skip("the saved text is a block page shared across sites");
					continue;
				}
				if (result.kind === "no-text-block") {
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
					url: entry.url,
					relatedCount: result.related.length,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
				});
			} catch (error) {
				if (error instanceof MetadataNotReadyError) {
					logger.info(
						"[ComputeRelatedArticles] waiting for crawl metadata; redelivery scheduled",
						{ url: error.url, messageId: record.messageId },
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
