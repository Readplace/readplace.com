import type { SaveAttemptId } from "@packages/domain/article";
import type { CandidateReference } from "../select-content/list-available-tier-sources";
import { candidateProvenance } from "../select-content/candidate-provenance";
import type { TierSourceMetadata } from "../select-content/tier-source.types";
import { blockedCauseForStatus } from "@packages/article-state-types";
import type { HutchLogger } from "@packages/hutch-logger";
import { resolveDocumentUrl, type ThumbnailCascade } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import { markCrawlBlocked, markCrawlFailed } from "@packages/domain/article-aggregate";
import {
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { ReadTierSnapshot } from "./read-tier-snapshot";
import { initEmitTier1FailureOutcome } from "./emit-tier-1-failure-outcome";
import { type FinalizeArticle, UNREADABLE_ARTICLE } from "@packages/finalize-article";
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

export type CommitFetchedBodyOutcome = CrawlTermination | { via: "unreadable"; reason: string };

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
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	logPrefix: string;
}) {
	const {
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
	} = deps;

	const { emitTier1FailureOutcome } = initEmitTier1FailureOutcome({
		readTierSnapshot,
		logCrawlOutcome,
		logger,
		logPrefix,
	});

	const publishArchiveComparison = async (ctx: {
		url: string;
		userId?: string;
		recrawl?: boolean;
		saveAttemptId: SaveAttemptId;
		candidates: CandidateReference[];
	}): Promise<CrawlTermination> => {
		const detail = {
			url: ctx.url,
			userId: ctx.userId,
			saveAttemptId: ctx.saveAttemptId,
			candidates: ctx.candidates,
			liveAttempt: { outcome: "no-body" as const },
			extractedAt: now().toISOString(),
		};
		if (ctx.recrawl) await publishEvent(RecrawlContentExtractedEvent, detail);
		else await publishEvent(TierContentExtractedEvent, detail);
		return { via: "deferred-to-event" };
	};

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

	const commitFetchedBody = async (
		body: DeferredCrawlBody,
		ctx: DeferredCrawlContext,
	): Promise<CommitFetchedBodyOutcome> => {
		const { url, originalUrl, refresh, recrawl, userId } = ctx;
		const fetchedAt = now().toISOString();
		const finalized = await finalizeArticle({
			writeContext: { url, attemptId: ctx.saveAttemptId },
			url: originalUrl,
			documentUrl: resolveDocumentUrl({ requestedUrl: url, finalUrl: body.finalUrl }),
			html: body.html,
			resolvedThumbnail: body.thumbnail,
			...(body.mediaType === "plain-text"
				? { mediaType: body.mediaType, plainText: body.plainText }
				: { mediaType: body.mediaType }),
		});
		if (!finalized.ok && ctx.candidates === undefined) {
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
		const metadata = candidateProvenance({
			metadata: article.metadata,
			html: article.html,
			evaluationHtml,
			attemptId: ctx.saveAttemptId,
			originalUrl: await deps.resolveOriginalUrl(url),
			sourceUrl: body.finalUrl ?? originalUrl,
			kind: "live",
			fetchedAt,
			httpStatus: body.httpStatus,
			renderedThrough: body.renderedThrough,
		});
		const candidates = [...(ctx.candidates ?? []), { id: metadata.id, tier: "tier-1" as const }];
		await putTierSource({
			url,
			tier: "tier-1",
			html: article.html,
			evaluationHtml,
			metadata,
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
		if (!refresh && !liveFailed) {
			await updateFetchTimestamp({
				url,
				contentFetchedAt,
				etag: body.etag,
				lastModified: body.lastModified,
				bodyHash: body.bodyHash,
			});
		}

		const successSnapshot = await readTierSnapshot({ url });
		logCrawlOutcome({
			url,
			thisTier: "tier-1",
			thisTierStatus: liveFailed ? "failed" : "success",
			otherTierStatus: successSnapshot.tier0Status,
			pickedTier: successSnapshot.pickedTier,
		});

		if (refresh) {
			// Stale-check refresh chain: a downstream handler runs the selector
			// across all tier sources, picks a winner, and drives the transition
			// that sets freshness and canonical content.
			await publishEvent(RefreshContentExtractedEvent, {
				url,
				candidates,
				saveAttemptId: ctx.saveAttemptId,
				etag: body.etag,
				lastModified: body.lastModified,
				contentFetchedAt,
				bodyHash: body.bodyHash,
			});
			logger.info(`${logPrefix} emitted RefreshContentExtractedEvent`, { url });
		} else if (recrawl) {
			// Recrawl chain runs a clone of the selector that ALWAYS dispatches
			// generate-summary regardless of canonical change. Emit the recrawl-
			// specific event so admin recrawls of PDFs preserve that semantics.
			await publishEvent(RecrawlContentExtractedEvent, { url, extractedAt: contentFetchedAt, candidates, saveAttemptId: ctx.saveAttemptId });
			logger.info(`${logPrefix} emitted RecrawlContentExtractedEvent`, { url });
		} else {
			await publishEvent(TierContentExtractedEvent, { url, userId, extractedAt: contentFetchedAt, candidates, saveAttemptId: ctx.saveAttemptId });
			logger.info(`${logPrefix} emitted TierContentExtractedEvent`, { url, tier: "tier-1" });
		}
		return { via: "deferred-to-event" };
	};

	return {
		commitFetchedBody,
		resolveUnreadable,
		resolveBudgetExhausted,
		resolveBlocked,
		publishArchiveComparison,
		emitTier1FailureOutcome,
	};
}
