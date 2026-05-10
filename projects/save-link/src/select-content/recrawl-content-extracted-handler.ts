import assert from "node:assert";
import type { SQSBatchItemFailure, SQSBatchResponse, SQSHandler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DispatchCommand, PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	type GenerateSummaryCommand,
	RecrawlContentExtractedEvent,
	RecrawlCompletedEvent,
} from "@packages/hutch-infra-components";
import type { MarkCrawlReady } from "../crawl-article-state/article-crawl.types";
import type { ListAvailableTierSources } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { PromoteTierToCanonical } from "./promote-tier-to-canonical";
import type { FindContentSourceTier } from "./find-content-source-tier";
import type { TierSource } from "./tier-source.types";

export function initRecrawlContentExtractedHandler(deps: {
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	promoteTierToCanonical: PromoteTierToCanonical;
	findContentSourceTier: FindContentSourceTier;
	markCrawlReady: MarkCrawlReady;
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
	publishEvent: PublishEvent;
	imagesCdnBaseUrl: string;
	logger: HutchLogger;
}): SQSHandler {
	const {
		listAvailableTierSources,
		selectMostCompleteContent,
		promoteTierToCanonical,
		findContentSourceTier,
		markCrawlReady,
		dispatchGenerateSummary,
		publishEvent,
		imagesCdnBaseUrl,
		logger,
	} = deps;
	const cdnHost = new URL(imagesCdnBaseUrl).host;

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
						/* The LLM treats "only image URLs differ" as a tie, but a
						 * recrawl after the Referer fix migrates <img src> from the
						 * origin to our CDN — never a wash. Hotlink-protected
						 * origins 403 the reader's browser
						 * without our server-side Referer trick, so any net-positive
						 * shift toward the CDN host is unambiguously an improvement.
						 * Override the tie when one candidate has more occurrences
						 * of the CDN host than the others. */
						const cdnTie = breakTieByCdnRewriteCount(sources, cdnHost);
						const existingTier = cdnTie ? undefined : await findContentSourceTier(detail.url);
						if (cdnTie) {
							winnerTier = cdnTie.tier;
							reason = cdnTie.reason;
						} else if (existingTier) {
							/* Recrawl tie + canonical already set: keep canonical
							 * exactly as-is; the operator still gets a fresh summary
							 * via the unconditional dispatchGenerateSummary below. */
							winnerTier = undefined;
							reason = decision.reason;
						} else {
							/* Tie with no canonical yet — i.e. recovering a row that
							 * the user-save flow left stuck because of the same tie
							 * pathology. Default to tier-1 (Readability) when present,
							 * else tier-0; both candidates carry identical content by
							 * definition of "tie", so this is a deterministic
							 * tiebreaker rather than a quality call. */
							const fallback =
								sources.find((source) => source.tier === "tier-1") ??
								sources.find((source) => source.tier === "tier-0");
							assert(fallback, "tie with no candidate tiers should be unreachable");
							winnerTier = fallback.tier;
							reason = `tie on recrawl recovery; defaulted to ${fallback.tier}`;
						}
					} else {
						winnerTier = decision.winner;
						reason = decision.reason;
					}
				}

				if (winnerTier !== undefined) {
					const winnerSource = sources.find((source) => source.tier === winnerTier);
					assert(winnerSource, `winner tier ${winnerTier} missing from candidate set`);

					await promoteTierToCanonical({
						url: detail.url,
						tier: winnerTier,
						metadata: winnerSource.metadata,
					});

					logger.info("[RecrawlContentExtracted] promoted tier to canonical", {
						url: detail.url,
						tier: winnerTier,
						reason,
					});
				} else {
					// Tie + canonical preserved: promoteTierToCanonical (the only writer
					// of crawlStatus="ready") was skipped, so we must flip the row back
					// out of the "pending" state that admin/recrawl's
					// forceMarkCrawlPending unconditionally wrote — otherwise readers
					// (and the Tier 1+ canary) poll a forever-"pending" row that never
					// resolves, since the canonical content is already on disk.
					await markCrawlReady({ url: detail.url });
					logger.info("[RecrawlContentExtracted] tie kept canonical unchanged", {
						url: detail.url,
						reason,
					});
				}

				/* Always dispatch — the user-save chain gates this on canonical
				 * change to dedup re-saves; recrawl explicitly opts out so the
				 * operator gets a fresh AI excerpt every time. */
				await dispatchGenerateSummary({ url: detail.url });

				await publishEvent({
					source: RecrawlCompletedEvent.source,
					detailType: RecrawlCompletedEvent.detailType,
					detail: JSON.stringify({ url: detail.url }),
				});
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

function breakTieByCdnRewriteCount(
	sources: readonly TierSource[],
	cdnHost: string,
): { tier: TierSource["tier"]; reason: string } | undefined {
	const counts = sources
		.map((source) => ({ tier: source.tier, count: countOccurrences(source.html, cdnHost) }))
		.sort((a, b) => b.count - a.count);
	const [top, second] = counts;
	if (!top || !second || top.count <= second.count) return undefined;
	return {
		tier: top.tier,
		reason: `tie broken: ${top.tier} has ${top.count} CDN-rewritten URLs vs ${second.count} in next candidate`,
	};
}

function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}
