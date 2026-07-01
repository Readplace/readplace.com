import type { HutchLogger } from "@packages/hutch-logger";
import {
	ensureCanonicalStub,
	markCanonicalAlias,
	markCrawlFailed,
	type TransitionAndPersist,
	type UpsertAndPersist,
} from "@packages/domain/article-aggregate";
import { ArticleResourceUniqueId } from "./article-resource-unique-id";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { LogCrawlOutcome, LogParseError } from "@packages/hutch-infra-components";
import type { CheckTier0SourceExists, ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";

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
 * `eventUrl` on the written result is the url the caller must publish its
 * follow-up event under: the canonical url when a cross-identity redirect was
 * re-keyed, otherwise the requested url. Publishing under a stale requested url
 * would run the selector against the wrong (alias) row.
 */
export type SaveLinkWorkResult =
	| { status: "tier-1-written"; eventUrl: string }
	| { status: "tier-1-deferred" };

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
	upsertAndPersist: UpsertAndPersist;
	checkTier0SourceExists: CheckTier0SourceExists;
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
		upsertAndPersist,
		checkTier0SourceExists,
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
			return { status: "tier-1-deferred" };
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

		/* The crawler followed the origin's redirects and the finalizer resolved
		 * the canonical identity (link rel=canonical / og:url / the final redirect
		 * target). When that canonical resolves to a DIFFERENT storage identity
		 * than the requested url, the tier-1 content, freshness, and follow-up
		 * event belong on the canonical row so every url that redirects there
		 * collapses to one reader/summary — not one row per requested spelling.
		 *
		 * Two carve-outs keep the requested identity: a recrawl re-fetches an
		 * existing identity in place (re-keying it would orphan the row the
		 * operator asked to refresh), and a requested url that already has its
		 * own tier-0 capture is honoured as-entered (the extension deliberately
		 * saved that url; the user chose "alias only when no tier-0 exists"). */
		const canonicalUrl = result.canonicalUrl;
		let contentUrl = url;
		let reKey = false;
		if (!options?.recrawl) {
			const identityDiffers =
				ArticleResourceUniqueId.parse(canonicalUrl).value !==
				ArticleResourceUniqueId.parse(url).value;
			if (identityDiffers) {
				const requestedHasTier0 = await checkTier0SourceExists({ url });
				if (!requestedHasTier0) {
					reKey = true;
					contentUrl = canonicalUrl;
				}
			}
		}

		if (reKey) {
			/* Guarantee the canonical row exists before the tier source + event so
			 * the selector's promoteTier (which asserts the row loads) has a target.
			 * Idempotent: an existing canonical row is left untouched. */
			await upsertAndPersist(ensureCanonicalStub, {
				url: contentUrl,
				input: { url: contentUrl, now: now().toISOString() },
			});
		}

		await putTierSource({
			url: contentUrl,
			tier: "tier-1",
			html: result.article.html,
			metadata: result.article.metadata,
		});
		await markCrawlStage({ url: contentUrl, stage: "crawl-content-uploaded" });

		await updateFetchTimestamp({
			url: contentUrl,
			contentFetchedAt: now().toISOString(),
			etag: result.etag,
			lastModified: result.lastModified,
			bodyHash: result.bodyHash,
		});

		if (reKey) {
			/* Point the requested row at the canonical so its reader/summary follow
			 * the pointer and neither canary flags it as stuck-pending. */
			await transitionAndPersist(markCanonicalAlias, {
				url,
				input: { canonicalUrl },
			});
		}

		const successSnapshot = await readTierSnapshot({ url: contentUrl });
		logCrawlOutcome({
			url: contentUrl,
			thisTier: "tier-1",
			thisTierStatus: "success",
			otherTierStatus: successSnapshot.tier0Status,
			pickedTier: successSnapshot.pickedTier,
		});

		logger.info(`${logPrefix} tier-1 source written`, {
			url: contentUrl,
			imageUrl: result.article.metadata.imageUrl ?? null,
		});
		return { status: "tier-1-written", eventUrl: contentUrl };
	};

	return { saveLinkWork };
}
