import type { SaveAttemptId } from "@packages/domain/article";
import type { CandidateReference } from "../select-content/list-available-tier-sources";
import { type CandidateAnnouncement, initCommitTierCandidate } from "../crawl-leg/commit-tier-candidate";
import { initPublishArchiveComparison } from "../crawl-leg/publish-archive-comparison";
import type { PutTierSource, TierSourceMetadata } from "@packages/tier-source";
import { blockedCauseForStatus } from "@packages/article-state-types";
import type { Logger } from "@packages/logger";
import type { ThumbnailCascade } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlBlocked, markCrawlFailed } from "@packages/domain/article-aggregate";
import type { LogCrawlOutcome, LogParseError } from "@packages/infra-components";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { ReadTierSnapshot } from "./read-tier-snapshot";
import { initEmitTier1FailureOutcome } from "./emit-tier-1-failure-outcome";
import { type FinalizeArticle, finalizeInputOfFetchedPage, UNREADABLE_ARTICLE } from "@packages/finalize-article";
import type { AdoptCanonicalIdentity } from "../save-link/adopt-canonical-identity";

/* Returning this disposition forces each branch to declare which;
 * a branch that does none fails to type-check. */
export type CrawlTermination =
	| { via: "committed-in-process" }
	| { via: "deferred-to-event" }
	| { via: "already-terminal" };

export type DeferredCrawlBody = {
	html: string;
	evaluationHtml?: string;
	thumbnail?: ThumbnailCascade;
	etag?: string;
	lastModified?: string;
	bodyHash: string;
	finalUrl?: string;
	httpStatus?: number;
	renderedThrough?: TierSourceMetadata["renderedThrough"];
} & ({ mediaType?: "image" } | { mediaType: "plain-text"; plainText: string });

export type DeferredCrawlContext = {
	url: string;
	originalUrl: string;
	saveAttemptId: SaveAttemptId;
	candidates?: CandidateReference[];
	refresh?: boolean;
	recrawl?: boolean;
	userId?: string;
	previousBodyHash?: string;
};

export type CommitFetchedBodyOutcome = { via: "deferred-to-event"; readable: boolean; candidate: CandidateReference } | { via: "unreadable"; reason: string };

export function initCommitDeferredCrawl(deps: {
	resolveOriginalUrl: (url: string) => Promise<string>;
	finalizeArticle: FinalizeArticle;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	logPrefix: string;
}) {
	const {
		finalizeArticle,
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
	} = deps;

	const commitTierCandidate = initCommitTierCandidate({ putTierSource: deps.putTierSource, publishEvent });

	const { emitTier1FailureOutcome } = initEmitTier1FailureOutcome({
		readTierSnapshot,
		logCrawlOutcome,
		logger,
		logPrefix,
	});

	const publishArchiveComparison = initPublishArchiveComparison({ publishEvent, now });

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
		recrawl?: boolean;
		userId?: string;
		saveAttemptId: SaveAttemptId;
		candidates?: CandidateReference[];
	}): Promise<CrawlTermination> => {
		if (ctx.candidates !== undefined) return publishArchiveComparison({ ...ctx, candidates: ctx.candidates });
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

	const resolveBlocked = async (ctx: { url: string; httpStatus: number }): Promise<CrawlTermination> => {
		const { url, httpStatus } = ctx;
		logParseError({ url, reason: `crawl-blocked: HTTP ${httpStatus}` });
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
					cause: blockedCauseForStatus(httpStatus),
				},
			},
		});
		return { via: "committed-in-process" };
	};

	const resolveUnreadable = async (ctx: { url: string; detail: string }): Promise<CrawlTermination> => {
		const { url, detail } = ctx;
		logParseError({ url, reason: detail });
		await emitTier1FailureOutcome({ url });
		await transitionAndPersist(markCrawlFailed, {
			url,
			input: {
				reason: { kind: "parse-error", detail },
			},
		});
		return { via: "committed-in-process" };
	};

	const commitBody = async (
		body: DeferredCrawlBody,
		ctx: DeferredCrawlContext,
		unreadable: "publish-when-comparing" | "return",
	): Promise<CommitFetchedBodyOutcome> => {
		const { url, originalUrl, refresh, recrawl, userId } = ctx;
		const fetchedAt = now().toISOString();
		const finalized = await finalizeArticle(
			finalizeInputOfFetchedPage({
				savedUrl: originalUrl,
				requestedUrl: url,
				writeContext: { url, attemptId: ctx.saveAttemptId },
				fetched: body,
			}),
		);
		if (!finalized.ok && (ctx.candidates === undefined || unreadable === "return")) {
			return { via: "unreadable", reason: finalized.reason };
		}
		const article = finalized.ok ? finalized.article : UNREADABLE_ARTICLE;
		const liveFailed = !finalized.ok || (body.httpStatus !== undefined && (body.httpStatus < 200 || body.httpStatus >= 300));
		const evaluationHtml = ctx.candidates === undefined ? article.html : body.evaluationHtml ?? body.html;

		/* Best-effort and never throws: a redirecting PDF/comprehensive URL
		 * claims its terminal identity here too. Refresh and recrawl are both
		 * re-crawls of an existing article, so folding either flag into
		 * `recrawl` suppresses re-adoption on every stale re-fetch. */
		await adoptCanonicalIdentity({
			url,
			finalUrl: body.finalUrl,
			outcome: liveFailed ? { kind: "crawl-failed" } : { kind: "finalized", wordCount: article.metadata.wordCount },
			recrawl: Boolean(recrawl || refresh),
		});
		let contentFetchedAt = "";
		const announcement = (): CandidateAnnouncement => {
			// Stale-check refresh chain: a downstream handler runs the selector
			// across all tier sources, picks a winner, and drives the transition
			// that sets freshness and canonical content.
			if (refresh) return { event: "refresh-content-extracted", etag: body.etag, lastModified: body.lastModified, contentFetchedAt, bodyHash: body.bodyHash };
			// Recrawl chain runs a clone of the selector that ALWAYS dispatches
			// generate-summary regardless of canonical change. Emit the recrawl-
			// specific event so admin recrawls of PDFs preserve that semantics.
			if (recrawl) return { event: "recrawl-content-extracted", extractedAt: () => contentFetchedAt };
			return { event: "tier-content-extracted", userId, extractedAt: () => contentFetchedAt };
		};
		const candidate = await commitTierCandidate({
			url,
			attemptId: ctx.saveAttemptId,
			originalUrl: await deps.resolveOriginalUrl(url),
			sourceUrl: body.finalUrl ?? originalUrl,
			fetchedAt,
			leg: { tier: "tier-1", kind: "live", httpStatus: body.httpStatus, renderedThrough: body.renderedThrough },
			metadata: article.metadata,
			html: article.html,
			evaluation: { hashed: evaluationHtml, stored: evaluationHtml },
			afterStore: async () => {
				await markCrawlStage({ url, stage: "crawl-content-uploaded" });
				contentFetchedAt = now().toISOString();
				/* Refresh chain carries freshness directly on the
				 * RefreshContentExtractedEvent and the downstream
				 * refresh-content-extracted handler sets it via the refreshContent
				 * aggregate transition, mirroring the existing in-place refresh
				 * Lambda. Save / recrawl chains have no aggregate write that
				 * persists etag/lastModified, so they still go through the
				 * UpdateFetchTimestampCommand → update-fetch-timestamp Lambda. */
				if (!refresh && !liveFailed) {
					await updateFetchTimestamp({
						url,
						contentFetchedAt,
						etag: body.etag,
						lastModified: body.lastModified,
						bodyHash: body.bodyHash,
					});
				}
			},
			crawlOutcome: { report: liveFailed ? "failed" : "success", readSnapshot: () => readTierSnapshot({ url }), logCrawlOutcome },
			priorCandidates: ctx.candidates,
			announce: announcement,
		});

		if (refresh) logger.info(`${logPrefix} emitted RefreshContentExtractedEvent`, { url });
		else if (recrawl) logger.info(`${logPrefix} emitted RecrawlContentExtractedEvent`, { url });
		else logger.info(`${logPrefix} emitted TierContentExtractedEvent`, { url, tier: "tier-1" });
		return { via: "deferred-to-event", readable: finalized.ok, candidate };
	};

	const commitFetchedBody = (body: DeferredCrawlBody, ctx: DeferredCrawlContext) => commitBody(body, ctx, "publish-when-comparing");
	const commitReadableBody = (body: DeferredCrawlBody, ctx: DeferredCrawlContext) => commitBody(body, ctx, "return");

	return {
		commitFetchedBody,
		commitReadableBody,
		resolveUnreadable,
		resolveBudgetExhausted,
		resolveBlocked,
		publishArchiveComparison,
		emitTier1FailureOutcome,
	};
}
