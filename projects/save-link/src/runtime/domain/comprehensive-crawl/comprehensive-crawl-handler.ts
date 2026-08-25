import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { blockedCauseForStatus } from "@packages/article-state-types";
import type { HutchLogger } from "@packages/hutch-logger";
import { type CrawlArticle, resolveDocumentUrl } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import {
	markCrawlBlocked,
	markCrawlFailed,
	markCrawlNotFound,
	markCrawlUnsupported,
} from "@packages/domain/article-aggregate";
import {
	ComprehensiveCrawlCommand,
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { MarkCrawlProgress } from "../../providers/article-crawl/mark-crawl-progress";
import type {
	ConsumePaidCrawlBudget,
	RefundPaidCrawlBudget,
} from "../../providers/paid-crawl-budget/dynamodb-paid-crawl-budget";
import { initProgressThrottle } from "../crawl-article-state/init-progress-throttle";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { initEmitTier1FailureOutcome } from "../crawl-article-state/emit-tier-1-failure-outcome";
import type { FinalizeArticle } from "@packages/finalize-article";
import type { AdoptCanonicalIdentity } from "../save-link/adopt-canonical-identity";

/* Every comprehensive-crawl record must account for the row's crawl axis being
 * in a terminal state: committed in-process here (unsupported), deferred to a
 * downstream *-ContentExtracted event whose handler runs the terminal
 * transition (fetched), or already terminal and left as-is (not-modified).
 * Returning this disposition forces each crawlResult branch to declare which;
 * a branch that does none fails to type-check. */
type CrawlTermination =
	| { via: "committed-in-process" }
	| { via: "deferred-to-event" }
	| { via: "already-terminal" };

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initComprehensiveCrawlHandler(deps: {
	crawlArticle: CrawlArticle;
	finalizeArticle: FinalizeArticle;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	markCrawlProgress: MarkCrawlProgress;
	consumePaidCrawlBudget: ConsumePaidCrawlBudget;
	refundPaidCrawlBudget: RefundPaidCrawlBudget;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	progressIntervalMs?: number;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		crawlArticle,
		finalizeArticle,
		putTierSource,
		updateFetchTimestamp,
		transitionAndPersist,
		markCrawlStage,
		markCrawlProgress,
		consumePaidCrawlBudget,
		refundPaidCrawlBudget,
		adoptCanonicalIdentity,
		publishEvent,
		now,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
		progressIntervalMs = 1500,
	} = deps;

	const logPrefix = "[ComprehensiveCrawlCommand]";

	const { emitTier1FailureOutcome } = initEmitTier1FailureOutcome({
		readTierSnapshot,
		logCrawlOutcome,
		logger,
		logPrefix,
	});

	/* Spend breaker, not a crawl error: the message is consumed (no SQS retry —
	 * a retry would re-spend the very budget that is exhausted) and the row is
	 * settled so readers see the terminal "link is saved, content unavailable"
	 * reframe instead of a forever-pending progress bar. markCrawlBlocked
	 * terminalises both axes (crawl=failed, summary=skipped) in one atomic save:
	 * the stub save set summary to `pending` and no *-ContentExtracted event will
	 * ever fire to advance it, so a partial two-write terminalisation could strand
	 * the row half-terminal (the comprehensive queue is maxReceiveCount=1, so the
	 * failed message hits a DLQ handler that only advances the crawl axis) and the
	 * stuck-articles canary would page an operator over a transient throttle. */
	const resolveBudgetExhausted = async (ctx: {
		url: string;
		refresh?: boolean;
	}): Promise<CrawlTermination> => {
		logParseError({ url: ctx.url, reason: "paid-crawl-budget-exhausted" });
		await emitTier1FailureOutcome({ url: ctx.url });
		if (ctx.refresh) {
			// A refresh re-checks an article that already has served content; the
			// prior canonical stays valid, its freshness simply doesn't bump.
			return { via: "already-terminal" };
		}
		await transitionAndPersist(markCrawlBlocked, {
			url: ctx.url,
			input: { reason: { kind: "blocked", cause: "spend-capped" } },
		});
		return { via: "committed-in-process" };
	};

	const resolveCrawlResult = async (
		crawlResult: Awaited<ReturnType<CrawlArticle>>,
		ctx: {
			url: string;
			refresh?: boolean;
			recrawl?: boolean;
			userId?: string;
			previousBodyHash?: string;
		},
	): Promise<CrawlTermination> => {
		const { url, refresh, recrawl, userId, previousBodyHash } = ctx;
		switch (crawlResult.status) {
			case "unsupported": {
				// Comprehensive saw the body and confirmed it cannot be extracted
				// (non-PDF body, PDF too large, OCR returned nothing, …). Flip the
				// row terminal here — no further dispatch.
				logParseError({ url, reason: `crawl-unsupported: ${crawlResult.reason}` });
				await emitTier1FailureOutcome({ url });
				await transitionAndPersist(markCrawlUnsupported, {
					url,
					input: {
						reason: { kind: "non-html-content", contentType: crawlResult.reason },
					},
				});
				logger.info(`${logPrefix} crawl unsupported — terminal`, { url });
				return { via: "committed-in-process" };
			}
			case "not-modified": {
				/* Pre-parse byte gate fired — the body is byte-identical to the
				 * stored hash, so the canonical row (content + terminal crawl
				 * status) from the prior successful crawl still holds; only the
				 * freshness timestamp needs bumping. A non-terminal status here is
				 * owned by a concurrent save / recrawl that terminalises it
				 * independently. */
				await updateFetchTimestamp({
					url,
					contentFetchedAt: now().toISOString(),
					bodyHash: previousBodyHash,
				});
				logger.info(`${logPrefix} crawl not-modified — pre-parse byte gate fired`, { url });
				return { via: "already-terminal" };
			}
			case "failed": {
				const reason = `crawl-${crawlResult.status}`;
				logParseError({ url, reason });
				await emitTier1FailureOutcome({ url });
				throw new Error(`crawl failed for ${url}: ${reason}`);
			}
			case "blocked": {
				logParseError({ url, reason: `crawl-blocked: HTTP ${crawlResult.httpStatus}` });
				await emitTier1FailureOutcome({ url });
				/* The origin's edge refuses this egress IP, which no retry from this
				 * Lambda can change. Settle the row so the reader can ask for a
				 * browser capture instead of the message dead-lettering and being
				 * relabelled `exhausted-retries`. */
				await transitionAndPersist(markCrawlBlocked, {
					url,
					input: {
						reason: {
							kind: "blocked",
							cause: blockedCauseForStatus(crawlResult.httpStatus),
						},
					},
				});
				return { via: "committed-in-process" };
			}
			case "not-found": {
				await emitTier1FailureOutcome({ url });
				await transitionAndPersist(markCrawlNotFound, {
					url,
					input: { reason: { kind: "not-found", httpStatus: crawlResult.httpStatus } },
				});
				return { via: "committed-in-process" };
			}
			case "fetched": {
				const finalized = await finalizeArticle({
					url,
					documentUrl: resolveDocumentUrl({ requestedUrl: url, finalUrl: crawlResult.finalUrl }),
					html: crawlResult.html,
					resolvedThumbnail: crawlResult.thumbnail,
				});
				if (!finalized.ok) {
					logParseError({ url, reason: finalized.reason });
					await emitTier1FailureOutcome({ url });
					await transitionAndPersist(markCrawlFailed, {
						url,
						input: {
							reason: { kind: "parse-error", detail: finalized.reason },
						},
					});
					throw new Error(`crawl failed for ${url}: ${finalized.reason}`);
				}

				await putTierSource({
					url,
					tier: "tier-1",
					html: finalized.article.html,
					metadata: finalized.article.metadata,
				});
				await markCrawlStage({ url, stage: "crawl-content-uploaded" });

				const contentFetchedAt = now().toISOString();

				/* Refresh chain carries freshness directly on the
				 * RefreshContentExtractedEvent and the downstream
				 * refresh-content-extracted handler sets it via the refreshContent
				 * aggregate transition, mirroring the existing in-place refresh
				 * Lambda. Save / recrawl chains have no aggregate write that
				 * persists etag/lastModified, so they still go through the
				 * UpdateFetchTimestampCommand → update-fetch-timestamp Lambda. */
				if (!refresh) {
					await updateFetchTimestamp({
						url,
						contentFetchedAt,
						etag: crawlResult.etag,
						lastModified: crawlResult.lastModified,
						bodyHash: crawlResult.bodyHash,
					});
				}

				const successSnapshot = await readTierSnapshot({ url });
				logCrawlOutcome({
					url,
					thisTier: "tier-1",
					thisTierStatus: "success",
					otherTierStatus: successSnapshot.tier0Status,
					pickedTier: successSnapshot.pickedTier,
				});

				/* Best-effort and never throws: a redirecting PDF/comprehensive URL
				 * claims its terminal identity here too. Refresh and recrawl are both
				 * re-crawls of an existing article, so folding either flag into
				 * `recrawl` suppresses re-adoption on every stale re-fetch. */
				await adoptCanonicalIdentity({
					url,
					finalUrl: crawlResult.finalUrl,
					outcome: { kind: "finalized", wordCount: finalized.article.metadata.wordCount },
					recrawl: Boolean(recrawl || refresh),
				});

				if (refresh) {
					// Stale-check refresh chain: a downstream handler runs the selector
					// across all tier sources, picks a winner, and drives the transition
					// that sets freshness and canonical content.
					await publishEvent(RefreshContentExtractedEvent, {
						url,
						etag: crawlResult.etag,
						lastModified: crawlResult.lastModified,
						contentFetchedAt,
						bodyHash: crawlResult.bodyHash,
					});
					logger.info(`${logPrefix} emitted RefreshContentExtractedEvent`, { url });
				} else if (recrawl) {
					// Recrawl chain runs a clone of the selector that ALWAYS dispatches
					// generate-summary regardless of canonical change. Emit the recrawl-
					// specific event so admin recrawls of PDFs preserve that semantics.
					await publishEvent(RecrawlContentExtractedEvent, { url, extractedAt: contentFetchedAt });
					logger.info(`${logPrefix} emitted RecrawlContentExtractedEvent`, { url });
				} else {
					await publishEvent(TierContentExtractedEvent, { url, tier: "tier-1", userId, extractedAt: contentFetchedAt });
					logger.info(`${logPrefix} emitted TierContentExtractedEvent`, { url, tier: "tier-1" });
				}
				return { via: "deferred-to-event" };
			}
		}
	};

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = ComprehensiveCrawlCommand.detailSchema.parse(envelope.detail);
				const { url, userId, recrawl, refresh, previousBodyHash } = detail;

				logger.info(`${logPrefix} processing`, {
					url,
					recrawl: recrawl ? 1 : 0,
					refresh: refresh ? 1 : 0,
				});

				/* Consume one spend slot, keyed on the message so the gate is safe to
				 * run on every receive: the provider claims a per-message marker in
				 * the same transaction as the counter increment, so a redelivery of an
				 * already-counted message re-checks the gate but adds nothing to the
				 * counter (one persistently-failing crawl can't drain the window
				 * through retries). A consume that errors — rather than denies —
				 * rethrows so the gate re-runs next receive (fail closed) instead of
				 * slipping past an exhausted budget. */
				const budget = await consumePaidCrawlBudget({ messageId: record.messageId });
				if (!budget.allowed) {
					logger.warn(`${logPrefix} paid-crawl budget exhausted — failing crawl gracefully`, { url });
					await resolveBudgetExhausted({ url, refresh });
					continue;
				}

				/*
				 * Server commits three coarse stages for the comprehensive path —
				 * `comprehensive-fetching` (written by the dispatcher in save-link-work
				 * before this Lambda is even invoked), `comprehensive-extracting`
				 * (Tesseract fan-out), and `comprehensive-cleaning` (LLM cleanup +
				 * diff review). The extractor signals the active stage on each
				 * onProgress call; we latch a stage write whenever the value
				 * changes. Falling back to `comprehensive-extracting` when the
				 * extractor omits a stage preserves the prior behaviour for any
				 * provider that hasn't been updated. Per-part progress
				 * (partCurrent/partTotal) is routed through a throttle so the OCR
				 * fan-out's chunk-completion firehose collapses to ~1 DDB write per
				 * `progressIntervalMs`, matching the UI's 3 s poll cadence.
				 */
				let latchedStage: "comprehensive-extracting" | "comprehensive-cleaning" | undefined;
				const progressThrottle = initProgressThrottle({
					markCrawlProgress,
					intervalMs: progressIntervalMs,
					now: () => Date.now(),
					logger,
				});
				const crawlResult = await crawlArticle({
					url,
					previousBodyHash,
					onProgress: ({ partIndex, partCount, stage }) => {
						const effectiveStage = stage ?? "comprehensive-extracting";
						if (effectiveStage !== latchedStage) {
							latchedStage = effectiveStage;
							markCrawlStage({ url, stage: effectiveStage }).catch((error: unknown) => {
								logger.warn(`${logPrefix} ${effectiveStage} stage write failed`, {
									url,
									error: String(error),
								});
							});
						}
						progressThrottle.report({ url, partCurrent: partIndex, partTotal: partCount });
					},
				});
				await progressThrottle.flush({ url });

				/* The pre-parse byte gate fired: a not-modified crawl did no OCR/LLM
				 * work, so the slot it reserved before crawlArticle goes back to the
				 * window rather than starve a genuinely-expensive crawl. Refund only a
				 * freshly-consumed slot — never an idempotent re-consume on redelivery,
				 * whose slot was already accounted on the first receive; best-effort,
				 * since a failed refund merely leaves the window slightly over-counted,
				 * which fails safe toward under-spending. */
				if (budget.consumed && crawlResult.status === "not-modified") {
					await refundPaidCrawlBudget().catch((error: unknown) => {
						logger.warn(`${logPrefix} paid-crawl budget refund failed`, {
							url,
							error: String(error),
						});
					});
				}

				await resolveCrawlResult(crawlResult, {
					url,
					refresh,
					recrawl,
					userId,
					previousBodyHash,
				});
			} catch (error) {
				logger.error(`${logPrefix} record failed`, {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
