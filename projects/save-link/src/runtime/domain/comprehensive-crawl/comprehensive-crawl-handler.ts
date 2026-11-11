import { CandidateIdSchema, type SaveAttemptId } from "@packages/domain/article";
import { z } from "zod";
import type { PaidLegPermit } from "@packages/provider-contracts/metered-leg-ledger";
import type { RunMeteredLeg } from "../metered-leg/run-metered-leg";
import { COMPREHENSIVE_CRAWL_TIMEOUTS } from "./timeouts";
import type { UserId } from "@packages/domain/user";
import assert from "node:assert";
import type { PrepareArticleIdentity, VerifyWrapperSource } from "@packages/save-article";
import { initCrawlAndFinalizeArticle } from "@packages/finalize-article";
import { initCrawlArchiveCapture } from "../save-link/crawl-archive-capture";
import type { CandidateReference } from "../select-content/list-available-tier-sources";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import type { CrawlArticle } from "@packages/crawl-article";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import {
	markCrawlAwaitingReader,
	markCrawlExhausted,
	markCrawlNotFound,
	markCrawlUnsupported,
} from "@packages/domain/article-aggregate";
import { crawlFailureReasonForFetchFailure } from "../save-link/crawl-failure-reason-for-fetch-failure";
import { ComprehensiveCrawlCommand, type CrawlTrigger } from "@packages/infra-components";
import type { MarkCrawlProgress, MarkCrawlStage } from "../crawl-article-state/crawl-stage.types";
import type {
	ConsumePaidCrawlBudget,
	RefundPaidCrawlBudget,
} from "./paid-crawl-budget.types";
import { initProgressThrottle } from "../crawl-article-state/init-progress-throttle";
import type { PutTierSource } from "@packages/tier-source";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { type CrawlTermination, initCommitDeferredCrawl } from "../crawl-article-state/commit-deferred-crawl";
import type { FinalizeArticle } from "@packages/finalize-article";
import type { AdoptCanonicalIdentity } from "../save-link/adopt-canonical-identity";

type CrawlArticleWithPermit = (
	params: Parameters<CrawlArticle>[0] & { permit: PaidLegPermit },
) => ReturnType<CrawlArticle>;

const RecordedComprehensiveCandidate = z.object({ id: CandidateIdSchema, tier: z.literal("tier-1") });

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initComprehensiveCrawlHandler(deps: {
	resolveOriginalUrl: (url: string) => Promise<string>;
	prepareArticleIdentity: PrepareArticleIdentity;
	verifyWrapperSource: VerifyWrapperSource;
	crawlArticleWithPermit: CrawlArticleWithPermit;
	runMeteredLeg: RunMeteredLeg;
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
	logger: Logger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	progressIntervalMs?: number;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		crawlArticleWithPermit,
		runMeteredLeg,
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
	const crawlArchiveCapture = (permit: PaidLegPermit) => initCrawlArchiveCapture({
		crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle: (params) => crawlArticleWithPermit({ ...params, permit }), finalizeArticle }),
		putTierSource,
		readTierSnapshot,
		logCrawlOutcome,
		publishEvent,
		logger,
		now,
		verifyWrapperSource: deps.verifyWrapperSource,
	});

	const {
		commitFetchedBody,
		resolveUnreadable,
		resolveBudgetExhausted,
		resolveBlocked,
		publishArchiveComparison,
		emitTier1FailureOutcome,
	} = initCommitDeferredCrawl({
		resolveOriginalUrl: deps.resolveOriginalUrl,
		finalizeArticle,
		putTierSource,
		updateFetchTimestamp,
		transitionAndPersist,
		markCrawlStage,
		adoptCanonicalIdentity,
		publishEvent,
		now,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
		logPrefix,
	});

	const resolveCrawlResult = async (
		crawlResult: Awaited<ReturnType<CrawlArticle>>,
		ctx: {
			url: string;
			originalUrl: string;
			trigger: CrawlTrigger;
			userId?: UserId;
			previousBodyHash?: string;
			saveAttemptId: SaveAttemptId;
			candidates?: CandidateReference[];
			receiveCount: number;
		},
	): Promise<CrawlTermination | { via: "deferred-to-event"; candidate: CandidateReference }> => {
		const { url, previousBodyHash } = ctx;
		if (ctx.candidates !== undefined && crawlResult.status !== "fetched") {
			return publishArchiveComparison({ ...ctx, recrawl: ctx.trigger === "recrawl", candidates: ctx.candidates });
		}
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
						reason: crawlResult.unsupportedReason ?? { kind: "non-html-content", contentType: crawlResult.reason },
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
				await transitionAndPersist(markCrawlExhausted, {
					url,
					input: {
						reason: crawlFailureReasonForFetchFailure(crawlResult.failure),
						receiveCount: ctx.receiveCount,
					},
				});
				return { via: "committed-in-process" };
			}
			case "blocked":
				return resolveBlocked({ url, httpStatus: crawlResult.httpStatus });
			case "not-found": {
				await emitTier1FailureOutcome({ url });
				await transitionAndPersist(markCrawlNotFound, {
					url,
					input: { reason: { kind: "not-found", httpStatus: crawlResult.httpStatus } },
				});
				return { via: "committed-in-process" };
			}
			case "fetched": {
				const committed = await commitFetchedBody(crawlResult, ctx);
				if (committed.via === "unreadable") {
					await resolveUnreadable({ url, detail: committed.reason });
					throw new Error(`crawl failed for ${url}: ${committed.reason}`);
				}
				return committed;
			}
		}
	};

	return initSqsRecordHandler({
		definition: ComprehensiveCrawlCommand,
		logger,
		failure: { message: `${logPrefix} record failed` },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { url, userId, trigger, previousBodyHash, saveAttemptId } = detail;
			const identity = await deps.prepareArticleIdentity(url);
			assert(identity.status === "resolved", "queued comprehensive article original is unresolved");
			const candidates = detail.candidates;

			logger.info(`${logPrefix} processing`, { url, trigger });

			const ctx = {
				url,
				originalUrl: identity.originalUrl,
				saveAttemptId,
				candidates,
				trigger,
				userId,
				previousBodyHash,
				receiveCount: record.receiveCount,
			};
			const leg = await runMeteredLeg({
				url,
				leg: "comprehensive",
				inputs: [identity.originalUrl, previousBodyHash ?? ""],
				claimId: record.messageId,
				claimTtlMs: COMPREHENSIVE_CRAWL_TIMEOUTS.sqsVisibilitySeconds * 1000,
				run: async (permit) => {
					let runCandidates = candidates;
					if (runCandidates === undefined && trigger !== "refresh" && identity.contentSourceUrl !== undefined) {
						const capture = await crawlArchiveCapture(permit)({
							url,
							captureUrl: identity.contentSourceUrl,
							sourceOriginalUrl: identity.sourceOriginalUrl,
							saveAttemptId,
						});
						runCandidates = capture === undefined ? [] : [capture];
					}
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
						await resolveBudgetExhausted({ url, trigger, userId, saveAttemptId, candidates: runCandidates });
						return { kind: "unsucceeded" };
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
					const crawlResult = await crawlArticleWithPermit({
						permit,
						url: identity.originalUrl,
						previousBodyHash,
						...(runCandidates !== undefined ? { retainResponseBody: true } : {}),
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

					const termination = await resolveCrawlResult(crawlResult, { ...ctx, candidates: runCandidates });
					return "candidate" in termination
						? { kind: "succeeded", outcome: JSON.stringify(termination.candidate) }
						: { kind: "unsucceeded" };
				},
			});
			if (leg.kind === "in-flight") logger.info(`${logPrefix} leg in flight under another message`, { url, leg: "comprehensive" });
			if (leg.kind === "deferred") {
				if (candidates !== undefined) await publishArchiveComparison({ ...ctx, recrawl: trigger === "recrawl", candidates });
				else if (trigger !== "refresh") await transitionAndPersist(markCrawlAwaitingReader, { url, input: { deferredLeg: "comprehensive" } });
				logger.info(`${logPrefix} comprehensive leg deferred until a reader opens the article`, { url });
			}
			if (leg.kind === "settled" && trigger !== "refresh") {
				const recorded = RecordedComprehensiveCandidate.parse(JSON.parse(leg.outcome));
				await publishArchiveComparison({ ...ctx, recrawl: trigger === "recrawl", candidates: [...(candidates ?? []), recorded] });
			}
		},
	});
}
