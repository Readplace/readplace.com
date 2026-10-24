import type {
	ArticleMetadata,
	Minutes,
	ArticleBody,
	CaptureTrigger,
} from "@packages/domain/article";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
} from "@packages/provider-contracts/article-crawl";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
} from "@packages/provider-contracts/article-summary";
import type {
	FindArticleByUrl,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	ReadArticleContent,
} from "@packages/provider-contracts/article-store";
import type { ReaderProvenance } from "../article-body/article-header/provenance-label";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ReaderReadlistTags } from "../article-body/article-header/article-header.component";
import type { CaptureWatch } from "./capture-watch";

export type ReaderViewFailure = { readerContentUnavailable: boolean };

export type ReaderViewFailedOob = (failure: ReaderViewFailure) => string;

export interface ArticleReaderDeps {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	findGeneratedSummary: FindGeneratedSummary;
	readArticleContent: ReadArticleContent;
	/**
	 * Reuses the existing freshness provider rather than widening the
	 * ArticleCrawl contract, which is consumed far more widely.
	 */
	findArticleFreshness: FindArticleFreshness;
	/**
	 * Per-article dated crawl-version log. Empty for pre-feature articles, where
	 * the reader falls back to the single `contentFetchedAt` instant.
	 */
	findArticleCrawlVersions: FindArticleCrawlVersions;
	/**
	 * Deployment origin. Poll responses re-render the reader iframe when a crawl
	 * finishes while the page is open, so the same-host link rewrite must run
	 * here too — not just on the initial SSR render.
	 */
	appOrigin: string;
	/**
	 * Used by the poll handlers to read the latest metadata on every tick so
	 * the header (title, siteName, readTime) and document <title> can settle
	 * in place once the crawl writes the real title over the hostname stub.
	 */
	findArticleByUrl: FindArticleByUrl;
	/**
	 * Each reader keeps its own browser-tab title format
	 * (queue: "X — Readplace Reader", view: "X | Reader View"). The article-
	 * reader emits the OOB <title> fragment using whatever the caller decides.
	 */
	formatDocumentTitle: (articleTitle: string) => string;
	/**
	 * Whether the TL;DR <details> renders expanded on poll responses. Required
	 * (not optional) so every reader makes the choice explicit: the internal
	 * /queue and admin readers default collapsed — an expand is then a
	 * deliberate, measurable act — while the public /view reader stays open.
	 */
	summaryOpen: boolean;
}

export interface ArticleSnapshot {
	url: string;
	metadata: ArticleMetadata;
	estimatedReadTime: Minutes;
}

export type CapturePollUrls = Readonly<Record<CaptureTrigger, string>>;

export interface PollUrlBuilder {
	summary: (pollCount: number) => string;
	reader: (pollCount: number, capture: CaptureWatch) => string;
}

export interface ArticleVersion {
	minuteId: string;
	date: LocalTime;
	time: LocalTime;
}

export interface ReaderState {
	content: ArticleBody | undefined;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	capturePollUrls: CapturePollUrls | undefined;
	/**
	 * Dated crawl versions, newest first; the first entry
	 * is the canonical/current version.
	 */
	crawlVersions: ArticleVersion[];
	readerViewFailed: boolean;
	readerContentUnavailable: boolean;
	notice: ReaderFailedVariant | undefined;
}

export interface ResolveReaderStateParams {
	article: ArticleSnapshot;
	pollUrlBuilder: PollUrlBuilder;
}

/**
 * Common poll handler input shared by `handleReaderPoll` and
 * `handleSummaryPoll`. Every field is required — including
 * `extensionInstallUrl` as `string | undefined` (not optional). The intent
 * is to force each reader page (admin recrawl, public /view, private
 * /queue/:id/read) to make an explicit decision about whether the OOB
 * sibling slot — which may render the reader-failed install CTA — should
 * include an install URL on this particular poll path. Defaulting silently
 * here is what got us the stuck-progress-bar bug in the first place.
 */
export interface HandlePollParams {
	articleUrl: string;
	articleId: string | undefined;
	pollCount: number;
	pollUrlBuilder: PollUrlBuilder;
	capture: CaptureWatch;
	extensionInstallUrl: string | undefined;
	/**
	 * Per-poll tracking URL stamped on the re-rendered TL;DR `<details>` so the
	 * client beacon can report open/close toggles. `undefined` on the public
	 * /view and admin readers, which do not record anonymous summary toggles;
	 * `string` only on the internal /queue reader. Required (not optional) so
	 * each poll path makes the decision explicit, mirroring `extensionInstallUrl`.
	 */
	summaryToggleUrl: string | undefined;
	/**
	 * Where the owner's save came from, re-sent on every poll because the OOB swap
	 * replaces the whole header — omitting it would drop the tag the moment the
	 * crawl settles. `undefined` on the public /view and admin readers, which
	 * render another user's article and hold no per-user row. Required (not
	 * optional) so each poll path makes the decision explicit, mirroring
	 * `extensionInstallUrl`.
	 */
	provenance: ReaderProvenance | undefined;
	saved: LocalTime | undefined;
	readlistTags: ReaderReadlistTags | undefined;
	readerViewFailedOob: ReaderViewFailedOob;
	renderDownloadsOob: ((articleUrl: string) => string) | undefined;
}
