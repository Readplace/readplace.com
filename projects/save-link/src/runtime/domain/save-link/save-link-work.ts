import { blockedCauseForStatus } from "@packages/article-state-types";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	markCrawlBlocked,
	markCrawlFailed,
	markCrawlNotFound,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import { initEmitTier1FailureOutcome } from "../crawl-article-state/emit-tier-1-failure-outcome";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import type { AdoptCanonicalIdentity } from "./adopt-canonical-identity";

/**
 * `"tier-1-written"` — the worker fetched, parsed, and wrote a tier-1 source.
 * The caller should publish TierContentExtractedEvent so the selector runs.
 *
 * `"tier-1-deferred"` — the simple crawl reported `unsupported` so the worker
 * emitted `SimpleCrawlUnsupportedEvent`. The policy Lambda subscribes and
 * dispatches `ComprehensiveCrawlCommand` to the dedicated PDF-handling
 * Lambda. The row stays in its current non-terminal state (the comprehensive
 * Lambda owns the next status transition + any downstream event). The caller
 * must NOT publish a follow-up event itself; the comprehensive Lambda emits
 * the appropriate event after it finishes (TierContentExtractedEvent or
 * RecrawlContentExtractedEvent).
 *
 * `"tier-1-terminal"` — the origin will not serve the page to this crawler
 * (HTTP 404/410, or an edge that refuses the datacenter IP) and the worker
 * terminalised both axes in-process. No tier source was written, so the caller
 * must NOT publish a follow-up event: there is no new content for a selector
 * to pick and no summary to generate.
 */
export type SaveLinkWorkResult = "tier-1-written" | "tier-1-deferred" | "tier-1-terminal";

export type SaveLinkWorkOptions = {
	userId?: string;
	recrawl?: boolean;
};

const CRAWL_FAILED_REASON = "crawl-failed";

class CrawlFailedError extends Error {
	readonly url: string;
	constructor(url: string) {
		super(`crawl failed for ${url}: ${CRAWL_FAILED_REASON}`);
		this.name = "CrawlFailedError";
		this.url = url;
	}
}

export function logRecordFailure(deps: {
	logger: HutchLogger;
	logPrefix: string;
	record: { messageId: string };
	error: unknown;
}): void {
	const { logger, logPrefix, record, error } = deps;
	if (error instanceof CrawlFailedError) {
		logger.warn(`${logPrefix} tier-1 crawl failed`, {
			url: error.url,
			messageId: record.messageId,
		});
	} else {
		logger.error(`${logPrefix} record failed`, {
			messageId: record.messageId,
			error,
		});
	}
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveLinkWork(deps: {
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	now: () => Date;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	logPrefix: string;
}): { saveLinkWork: (url: string, options?: SaveLinkWorkOptions) => Promise<SaveLinkWorkResult> } {
	const {
		crawlAndFinalizeArticle,
		emitSimpleCrawlUnsupported,
		putTierSource,
		updateFetchTimestamp,
		transitionAndPersist,
		markCrawlStage,
		adoptCanonicalIdentity,
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

	const saveLinkWork = async (url: string, options?: SaveLinkWorkOptions): Promise<SaveLinkWorkResult> => {
		await markCrawlStage({ url, stage: "crawl-fetching" });
		const result = await crawlAndFinalizeArticle({ url });

		if (result.status === "unsupported") {
			/* The simple crawl bailed because the origin returned a non-html body.
			 * Defer to the comprehensive Lambda — it extracts and decides whether
			 * the content is a PDF (handle) or something else (mark unsupported).
			 * `comprehensive-fetching` is written before the emit so the reader's
			 * progress bar moves forward immediately. */
			await markCrawlStage({ url, stage: "comprehensive-fetching" });
			await emitSimpleCrawlUnsupported({ url, userId: options?.userId, recrawl: options?.recrawl });
			logger.info(`${logPrefix} tier-1 deferred to comprehensive crawl`, {
				url,
				reason: result.reason,
			});
			return "tier-1-deferred";
		}

		if (result.status === "not-found") {
			await emitTier1FailureOutcome({ url });
			await transitionAndPersist(markCrawlNotFound, {
				url,
				input: { reason: { kind: "not-found", httpStatus: result.httpStatus } },
			});
			await adoptCanonicalIdentity({
				url,
				finalUrl: result.finalUrl,
				outcome: { kind: "crawl-failed" },
				recrawl: options?.recrawl,
			});
			return "tier-1-terminal";
		}

		if (result.status === "blocked") {
			logParseError({ url, reason: `crawl-blocked: HTTP ${result.httpStatus}` });
			await emitTier1FailureOutcome({ url });
			await transitionAndPersist(markCrawlBlocked, {
				url,
				input: {
					reason: { kind: "blocked", cause: blockedCauseForStatus(result.httpStatus) },
				},
			});
			await adoptCanonicalIdentity({
				url,
				finalUrl: result.finalUrl,
				outcome: { kind: "crawl-failed" },
				recrawl: options?.recrawl,
			});
			return "tier-1-terminal";
		}

		if (result.status === "failed") {
			if (result.reason !== CRAWL_FAILED_REASON) {
				logParseError({ url, reason: result.reason });
			}
			await emitTier1FailureOutcome({ url });
			await adoptCanonicalIdentity({
				url,
				finalUrl: result.finalUrl,
				outcome: { kind: "crawl-failed" },
				recrawl: options?.recrawl,
			});
			if (result.reason === CRAWL_FAILED_REASON) {
				throw new CrawlFailedError(url);
			}
			/* Parse-error reasons are terminal — re-running yields the same failure.
			 * Flip the crawl state to `failed` immediately so readers and the canary
			 * see it on the next poll, not after the SQS retry → DLQ delay.
			 * Network "crawl-failed" reasons let SQS retry and only land at DLQ
			 * after maxReceiveCount. */
			await transitionAndPersist(markCrawlFailed, {
				url,
				input: { reason: { kind: "parse-error", detail: result.reason } },
			});
			throw new Error(`crawl failed for ${url}: ${result.reason}`);
		}

		if (result.status === "not-modified") {
			/* `not-modified` is only possible when the caller passed etag/lastModified
			 * — save-link-work always does a fresh fetch (no conditional headers),
			 * so the crawler can never short-circuit here. Stale-check is the path
			 * that handles `not-modified`. */
			throw new Error(`save-link-work received unexpected not-modified for ${url}`);
		}

		await putTierSource({
			url,
			tier: "tier-1",
			html: result.article.html,
			metadata: result.article.metadata,
		});
		await markCrawlStage({ url, stage: "crawl-content-uploaded" });

		await updateFetchTimestamp({
			url,
			contentFetchedAt: now().toISOString(),
			etag: result.etag,
			lastModified: result.lastModified,
			bodyHash: result.bodyHash,
		});

		const successSnapshot = await readTierSnapshot({ url });
		logCrawlOutcome({
			url,
			thisTier: "tier-1",
			thisTierStatus: "success",
			otherTierStatus: successSnapshot.tier0Status,
			pickedTier: successSnapshot.pickedTier,
		});

		await adoptCanonicalIdentity({
			url,
			finalUrl: result.finalUrl,
			outcome: { kind: "finalized", wordCount: result.article.metadata.wordCount },
			recrawl: options?.recrawl,
		});

		logger.info(`${logPrefix} tier-1 source written`, {
			url,
			imageUrl: result.article.metadata.imageUrl ?? null,
		});
		return "tier-1-written";
	};

	return { saveLinkWork };
}
