import assert from "node:assert";
import {
	refreshContent,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { RefreshContentExtractedEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { FindContentSourceTier } from "../../providers/article-store/find-content-source-tier";
import type { ListAvailableTierSources } from "./list-available-tier-sources";
import type { WriteCanonicalContent } from "../../providers/article-store/promote-tier-to-canonical";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import type { SelectMostCompleteContent } from "./select-content";

/**
 * Mirror of recrawl-content-extracted-handler for the refresh path.
 *
 * Refresh writes the freshly-fetched HTML as a tier-1 source, then this
 * handler runs the selector over ALL available tier sources so an existing
 * tier-0 winner doesn't silently flip to tier-1 just because refresh
 * always lands at tier-1.
 */
export function initRefreshContentExtractedHandler(deps: {
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	writeCanonicalContent: WriteCanonicalContent;
	findContentSourceTier: FindContentSourceTier;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		listAvailableTierSources,
		selectMostCompleteContent,
		writeCanonicalContent,
		findContentSourceTier,
		transitionAndPersist,
		now,
		logger,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RefreshContentExtractedEvent.detailSchema.parse(envelope.detail);

				const sources = await listAvailableTierSources(detail.url);
				if (sources.length === 0) {
					/* Throw so SQS redelivers after the visibility timeout. Same
					 * worker→S3→EventBridge→SQS race as in the recrawl handler. */
					logger.warn("[RefreshContentExtracted] no tier sources available, retrying", {
						url: detail.url,
					});
					throw new Error(
						`no tier sources available for ${detail.url}; will retry`,
					);
				}

				let winnerTier: (typeof sources)[number]["tier"];
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
					logger.info("[RefreshContentExtracted] selector decision", {
						url: detail.url,
						winner: decision.winner,
						reason: decision.reason,
					});
					if (decision.winner === "tie") {
						const existingTier = await findContentSourceTier(detail.url);
						/* Tie on refresh: keep whatever the canonical tier was before
						 * the refresh. If there is no canonical (legacy stub row),
						 * default to tier-1 since the refresh just produced one. */
						winnerTier = existingTier ?? "tier-1";
						reason = `tie on refresh; kept ${winnerTier}`;
					} else {
						winnerTier = decision.winner;
						reason = decision.reason;
					}
				}

				const winnerSource = sources.find((source) => source.tier === winnerTier);
				assert(winnerSource, `winner tier ${winnerTier} missing from candidate set`);
				const canonicalContentHash = computeCanonicalContentHash(winnerSource.html);

				const existingTier = await findContentSourceTier(detail.url);
				if (existingTier !== winnerTier) {
					await writeCanonicalContent({ url: detail.url, tier: winnerTier });
				}

				await transitionAndPersist(refreshContent, {
					url: detail.url,
					input: {
						metadata: {
							title: winnerSource.metadata.title,
							siteName: winnerSource.metadata.siteName,
							excerpt: winnerSource.metadata.excerpt,
							wordCount: winnerSource.metadata.wordCount,
							imageUrl: winnerSource.metadata.imageUrl,
						},
						freshness: {
							etag: detail.etag,
							lastModified: detail.lastModified,
							contentFetchedAt: detail.contentFetchedAt,
						},
						estimatedReadTime: winnerSource.metadata.estimatedReadTime,
						now: now().toISOString(),
						canonicalContentHash,
					},
				});

				logger.info("[RefreshContentExtracted] refresh completed", {
					url: detail.url,
					tier: winnerTier,
					reason,
				});
			} catch (error) {
				logger.error("[RefreshContentExtracted] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
