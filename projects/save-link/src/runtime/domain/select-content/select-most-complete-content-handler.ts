import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	type LoadArticle,
	type TransitionAndPersist,
	promoteTier,
} from "@packages/domain/article-aggregate";
import {
	TierContentExtractedEvent,
	CrawlArticleCompletedEvent,
} from "@packages/hutch-infra-components";
import type { ListAvailableTierSources } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { WriteCanonicalContent } from "../../providers/article-store/promote-tier-to-canonical";
import type { FindContentSourceTier } from "../../providers/article-store/find-content-source-tier";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import { resolveCanonicalImageUrl } from "./resolve-canonical-image-url";
import type { TierSource } from "./tier-source.types";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSelectMostCompleteContentHandler(deps: {
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	writeCanonicalContent: WriteCanonicalContent;
	findContentSourceTier: FindContentSourceTier;
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	publishEvent: PublishEvent;
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
		publishEvent,
		now,
		logger,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = TierContentExtractedEvent.detailSchema.parse(envelope.detail);

				const sources = await listAvailableTierSources(detail.url);
				if (sources.length === 0) {
					/* Throw so SQS redelivers after the visibility timeout. The
					 * common cause is a transient race between the worker writing
					 * `<tier>.html` + sidecar to S3 and EventBridge → SQS delivery
					 * arriving here; a later retry from the same message converges
					 * once both objects are listable. After maxReceiveCount the
					 * message lands in the DLQ, where the DLQ handler flips
					 * crawlStatus to "failed" and emits CrawlArticleFailedEvent.
					 * Surrounding try/catch routes the throw to batchItemFailures
					 * so sibling records still settle under any future
					 * batchSize > 1. */
					logger.warn("[SelectContent] no tier sources available, retrying", {
						url: detail.url,
					});
					throw new Error(
						`no tier sources available for ${detail.url}; will retry`,
					);
				}

				let winnerTier: TierSource["tier"];
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
					logger.info("[SelectContent] selector decision", {
						url: detail.url,
						winner: decision.winner,
						reason: decision.reason,
					});
					if (decision.winner === "tie") {
						const existingTier = await findContentSourceTier(detail.url);
						const existingArticle = existingTier
							? await loadArticle(detail.url)
							: undefined;
						const summaryStuckOnTooShort =
							existingArticle?.summary.kind === "skipped" &&
							existingArticle.summary.reason === "content-too-short";
						const canonicalIsHealthy = existingTier && !summaryStuckOnTooShort;
						if (canonicalIsHealthy) {
							/* Recrawl tie: a canonical already exists. Promoting the
							 * same content again would be a no-op write but a real
							 * summary regeneration — wasted Deepseek tokens. Emit
							 * CrawlArticleCompleted directly to settle the pipeline
							 * and skip; no aggregate transition because crawl/summary
							 * state is unchanged. */
							await publishEvent(CrawlArticleCompletedEvent, { url: detail.url });
							continue;
						}
						/* Either first save (no canonical yet) OR canonical exists
						 * but its summary is skipped("content-too-short") — i.e.
						 * the previous canonical's content was inadequate. In both
						 * cases, by definition of "tie" both tiers carry equivalent
						 * content; prefer tier-1 (Readability-parsed) when present,
						 * else tier-0. promoteTier announces CanonicalContentChanged,
						 * and the subscriber re-primes the summary so it regenerates
						 * against the new canonical. */
						const fallback =
							sources.find((source) => source.tier === "tier-1") ??
							sources.find((source) => source.tier === "tier-0");
						assert(fallback, "tie with no candidate tiers should be unreachable");
						winnerTier = fallback.tier;
						reason = summaryStuckOnTooShort
							? `tie + canonical summary skipped on too-short content; promoted ${fallback.tier} to retry`
							: `tie on first save; defaulted to ${fallback.tier}`;
					} else {
						winnerTier = decision.winner;
						reason = decision.reason;
					}
				}

				const winnerSource = sources.find((source) => source.tier === winnerTier);
				/* Invariant: the selector maps its label back to a tier in
				 * the candidate list (single-source short-circuits to its own
				 * tier; multi-source maps via labelForIndex). A miss here would
				 * be a programming error in the selector — assert rather than
				 * silently skip so the bug surfaces as a DLQ. */
				assert(winnerSource, `winner tier ${winnerTier} missing from candidate set`);

				const currentTier = await findContentSourceTier(detail.url);
				const canonicalChanged = currentTier !== winnerTier;
				const canonicalContentHash = computeCanonicalContentHash(winnerSource.html);

				await writeCanonicalContent({ url: detail.url, tier: winnerTier });

				await transitionAndPersist(promoteTier, {
					url: detail.url,
					input: {
						tier: winnerTier,
						metadata: {
							...winnerSource.metadata,
							imageUrl: resolveCanonicalImageUrl({ winner: winnerSource, candidates: sources }),
						},
						estimatedReadTime: winnerSource.metadata.estimatedReadTime,
						contentFetchedAt: now().toISOString(),
						now: now().toISOString(),
						canonicalChanged,
						canonicalContentHash,
						userId: detail.userId,
					},
				});

				logger.info(
					canonicalChanged
						? "[SelectContent] promoted tier to canonical"
						: "[SelectContent] re-selected same tier; canonical unchanged",
					{ url: detail.url, tier: winnerTier, reason },
				);
			} catch (error) {
				logger.error("[SelectContent] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
