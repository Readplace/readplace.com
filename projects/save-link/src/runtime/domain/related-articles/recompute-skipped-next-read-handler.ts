import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import { CanonicalContentChangedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	FindRelatedTargetArticle,
	FindSkippedNextReadSaves,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
	RelatedTargetArticle,
	RelatedTargetLookup,
} from "@packages/provider-contracts/related-articles";
import { MetadataNotReadyError, initNextReadComputation } from "./next-read-computation";
import type { GatherRelatedCandidatePools } from "./related-articles-candidates";
import type { SelectRelatedArticles } from "./related-articles-selector";

const TRIGGER = "content-changed";

type RuledOutReason =
	| "absent"
	| "purged"
	| "not an article host"
	| "not readable"
	| "crawl produced no metadata to compare";

type RecomputeTarget =
	| { kind: "ruled-out"; reason: RuledOutReason }
	| { kind: "readable"; target: RelatedTargetArticle; readerAvailableAt: Date };

function recomputeTargetOf(lookup: RelatedTargetLookup): RecomputeTarget {
	if (lookup.state === "absent") return { kind: "ruled-out", reason: "absent" };
	if (lookup.state === "purged") return { kind: "ruled-out", reason: "purged" };
	if (lookup.state === "not-an-article") return { kind: "ruled-out", reason: "not an article host" };
	const { readerAvailableAt } = lookup.article;
	if (readerAvailableAt === undefined) return { kind: "ruled-out", reason: "not readable" };
	if (lookup.article.hasStubMetadata) {
		return { kind: "ruled-out", reason: "crawl produced no metadata to compare" };
	}
	return { kind: "readable", target: lookup.article, readerAvailableAt };
}

export function initRecomputeSkippedNextReadHandler(deps: {
	findRelatedTargetArticle: FindRelatedTargetArticle;
	findSkippedNextReadSaves: FindSkippedNextReadSaves;
	gatherRelatedCandidatePools: GatherRelatedCandidatePools;
	selectRelatedArticles: SelectRelatedArticles;
	replaceSkippedRelatedArticlesWithReady: MarkRelatedArticlesReady;
	replaceSkippedRelatedArticlesWithSkip: MarkRelatedArticlesSkipped;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { findRelatedTargetArticle, findSkippedNextReadSaves, logger } = deps;
	const { computeNextRead } = initNextReadComputation({
		gatherRelatedCandidatePools: deps.gatherRelatedCandidatePools,
		selectRelatedArticles: deps.selectRelatedArticles,
		markRelatedArticlesReady: deps.replaceSkippedRelatedArticlesWithReady,
		markRelatedArticlesSkipped: deps.replaceSkippedRelatedArticlesWithSkip,
		publishEvent: deps.publishEvent,
		now: deps.now,
		logger,
	});

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			const receiveCount = Number(record.attributes.ApproximateReceiveCount);
			try {
				const envelope = JSON.parse(record.body);
				const { url } = CanonicalContentChangedEvent.detailSchema.parse(envelope.detail);

				const recompute = recomputeTargetOf(
					await findRelatedTargetArticle(url, { consistentRead: true }),
				);
				if (recompute.kind === "ruled-out") {
					logger.info("[ComputeRelatedArticles] content changed", {
						url,
						recomputing: 0,
						reason: recompute.reason,
					});
					continue;
				}

				const readableAtMs = recompute.readerAvailableAt.getTime();
				const eligible = (await findSkippedNextReadSaves(url)).filter(
					(save) => save.skippedAt.getTime() < readableAtMs,
				);
				logger.info("[ComputeRelatedArticles] content changed", {
					url,
					recomputing: eligible.length,
				});

				for (const save of eligible) {
					await computeNextRead({
						save: { userId: save.userId, url, receiveCount, trigger: TRIGGER },
						target: recompute.target,
					});
				}
			} catch (error) {
				if (error instanceof MetadataNotReadyError) {
					logger.info(
						"[ComputeRelatedArticles] waiting for crawl metadata; redelivery scheduled",
						{
							url: error.url,
							messageId: record.messageId,
							receiveCount,
							crawlStatus: error.crawlStatus,
							trigger: TRIGGER,
						},
					);
				} else {
					logger.error("[ComputeRelatedArticles] record failed", {
						messageId: record.messageId,
						error,
						trigger: TRIGGER,
					});
				}
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
