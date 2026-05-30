import type { HutchLogger } from "@packages/hutch-logger";
import {
	markCrawlFailed,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { CrawlAndFinalizeArticle } from "./crawl-and-finalize-article";

export type { ProcessContent } from "./finalize-article";

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
 */
export type SaveLinkWorkResult = "tier-1-written" | "tier-1-deferred";

export type SaveLinkWorkOptions = {
	userId?: string;
	recrawl?: boolean;
};

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSaveLinkWork(deps: {
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
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
		now,
		logger,
		logParseError,
		logCrawlOutcome,
		readTierSnapshot,
		logPrefix,
	} = deps;

	const emitTier1Failure = async (url: string): Promise<void> => {
		const snapshot = await readTierSnapshot({ url });
		logCrawlOutcome({
			url,
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: snapshot.tier0Status,
			pickedTier: snapshot.pickedTier,
		});
	};

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

		if (result.status === "failed") {
			logParseError({ url, reason: result.reason });
			/* Parse-error reasons are terminal — re-running yields the same failure.
			 * Flip the crawl state to `failed` immediately so readers and the canary
			 * see it on the next poll, not after the SQS retry → DLQ delay.
			 * Network "crawl-failed" reasons let SQS retry and only land at DLQ
			 * after maxReceiveCount. */
			if (result.reason !== "crawl-failed") {
				await transitionAndPersist(markCrawlFailed, {
					url,
					input: { reason: { kind: "parse-error", detail: result.reason } },
				});
			}
			await emitTier1Failure(url);
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

		logger.info(`${logPrefix} tier-1 source written`, {
			url,
			imageUrl: result.article.metadata.imageUrl ?? null,
		});
		return "tier-1-written";
	};

	return { saveLinkWork };
}
