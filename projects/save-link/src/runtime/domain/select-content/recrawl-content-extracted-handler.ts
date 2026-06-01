import assert from "node:assert";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	type LoadArticle,
	type TransitionAndPersist,
	recrawlPromoteTier,
	recrawlTieKeptCanonical,
} from "@packages/domain/article-aggregate";
import { RecrawlContentExtractedEvent } from "@packages/hutch-infra-components";
import type { ListAvailableTierSources } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { WriteCanonicalContent } from "../../providers/article-store/promote-tier-to-canonical";
import type { FindContentSourceTier } from "../../providers/article-store/find-content-source-tier";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import { resolveCanonicalImageUrl } from "./resolve-canonical-image-url";
import { resolveTie } from "./resolve-tie";
import type { TierSource } from "./tier-source.types";

export function initRecrawlContentExtractedHandler(deps: {
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	writeCanonicalContent: WriteCanonicalContent;
	findContentSourceTier: FindContentSourceTier;
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		listAvailableTierSources,
		selectMostCompleteContent,
		writeCanonicalContent,
		findContentSourceTier,
		loadArticle,
		transitionAndPersist,
		now,
		logger,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RecrawlContentExtractedEvent.detailSchema.parse(envelope.detail);

				const sources = await listAvailableTierSources(detail.url);
				if (sources.length === 0) {
					/* Throw so SQS redelivers after the visibility timeout. Same
					 * worker→S3→EventBridge→SQS race as in select-most-complete-content-handler;
					 * after maxReceiveCount the DLQ handler flips crawlStatus to "failed".
					 * Surrounding try/catch routes the throw to batchItemFailures
					 * so sibling records still settle under any future
					 * batchSize > 1. */
					logger.warn("[RecrawlContentExtracted] no tier sources available, retrying", {
						url: detail.url,
					});
					throw new Error(
						`no tier sources available for ${detail.url}; will retry`,
					);
				}

				let winnerTier: TierSource["tier"] | undefined;
				let reason: string;
				if (sources.length === 1) {
					winnerTier = sources[0].tier;
					reason = "only available tier";
				} else {
					const decision = await selectMostCompleteContent({
						url: detail.url,
						candidates: sources.map((source) => ({
							tier: source.tier,
							title: source.metadata.title,
							wordCount: source.metadata.wordCount,
							html: source.html,
						})),
					});
					logger.info("[RecrawlContentExtracted] selector decision", {
						url: detail.url,
						winner: decision.winner,
						reason: decision.reason,
					});
					if (decision.winner === "tie") {
						const resolution = await resolveTie({
							sources,
							freshTier: "tier-1",
							url: detail.url,
							findContentSourceTier,
							loadArticle,
						});
						if (resolution.kind === "keep-canonical") {
							winnerTier = undefined;
							reason = decision.reason;
						} else {
							winnerTier = resolution.tier;
							reason = resolution.reason;
						}
					} else {
						winnerTier = decision.winner;
						reason = decision.reason;
					}
				}

				if (winnerTier !== undefined) {
					const winnerSource = sources.find((source) => source.tier === winnerTier);
					assert(winnerSource, `winner tier ${winnerTier} missing from candidate set`);
					const canonicalContentHash = computeCanonicalContentHash(winnerSource.html);

					await writeCanonicalContent({ url: detail.url, tier: winnerTier });

					await transitionAndPersist(recrawlPromoteTier, {
						url: detail.url,
						input: {
							winnerTier,
							metadata: {
								...winnerSource.metadata,
								imageUrl: resolveCanonicalImageUrl({ winner: winnerSource, candidates: sources }),
							},
							estimatedReadTime: winnerSource.metadata.estimatedReadTime,
							contentFetchedAt: now().toISOString(),
							now: now().toISOString(),
							canonicalContentHash,
						},
					});

					logger.info("[RecrawlContentExtracted] promoted tier to canonical", {
						url: detail.url,
						tier: winnerTier,
						reason,
					});
				} else {
					await transitionAndPersist(recrawlTieKeptCanonical, {
						url: detail.url,
						input: { now: now().toISOString() },
					});
					logger.info("[RecrawlContentExtracted] tie kept canonical unchanged", {
						url: detail.url,
						reason,
					});
				}
			} catch (error) {
				logger.error("[RecrawlContentExtracted] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
