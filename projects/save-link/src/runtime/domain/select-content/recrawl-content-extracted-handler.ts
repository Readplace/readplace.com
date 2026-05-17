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
import type { TierSource } from "./tier-source.types";

export function initRecrawlContentExtractedHandler(deps: {
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	writeCanonicalContent: WriteCanonicalContent;
	findContentSourceTier: FindContentSourceTier;
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	imagesCdnBaseUrl: string;
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
		imagesCdnBaseUrl,
		now,
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
						const existingArticle = existingTier
							? await loadArticle(detail.url)
							: undefined;
						const summaryStuckOnTooShort =
							existingArticle?.summary.kind === "skipped" &&
							existingArticle.summary.reason === "content-too-short";
						if (cdnTie) {
							winnerTier = cdnTie.tier;
							reason = cdnTie.reason;
						} else if (existingTier && !summaryStuckOnTooShort) {
							winnerTier = undefined;
							reason = decision.reason;
						} else {
							/* Either tie with no canonical yet (recovering a stuck
							 * row), OR canonical exists but its summary is
							 * skipped("content-too-short") — the previous canonical's
							 * content was inadequate. By definition of "tie" both
							 * tiers carry equivalent content; prefer tier-1
							 * (Readability) when present, else tier-0. */
							const fallback =
								sources.find((source) => source.tier === "tier-1") ??
								sources.find((source) => source.tier === "tier-0");
							assert(fallback, "tie with no candidate tiers should be unreachable");
							winnerTier = fallback.tier;
							reason = summaryStuckOnTooShort
								? `tie + canonical summary skipped on too-short content; promoted ${fallback.tier} to retry`
								: `tie on recrawl recovery; defaulted to ${fallback.tier}`;
						}
					} else {
						winnerTier = decision.winner;
						reason = decision.reason;
					}
				}

				if (winnerTier !== undefined) {
					const winnerSource = sources.find((source) => source.tier === winnerTier);
					assert(winnerSource, `winner tier ${winnerTier} missing from candidate set`);

					await writeCanonicalContent({ url: detail.url, tier: winnerTier });

					await transitionAndPersist(recrawlPromoteTier, {
						url: detail.url,
						input: {
							winnerTier,
							metadata: winnerSource.metadata,
							estimatedReadTime: winnerSource.metadata.estimatedReadTime,
							contentFetchedAt: now().toISOString(),
							now: now().toISOString(),
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
						input: undefined,
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
