import type {
	ArticleMetadata,
	Minutes,
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
import type { ProgressTick } from "@packages/domain/article";
import type { LocalTime } from "@packages/web-shell/local-time.format";

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
	now: () => Date;
}

export interface ArticleSnapshot {
	url: string;
	metadata: ArticleMetadata;
	estimatedReadTime: Minutes;
}

export interface PollUrlBuilder {
	summary: (pollCount: number) => string;
	reader: (pollCount: number, capturing: boolean) => string;
}

export interface ReaderState {
	content: string | undefined;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	capturePollUrl: string;
	/**
	 * Single unified progress tick driving the article-body progress bar.
	 * Computed from whichever pipeline (crawl → summary) is in flight,
	 * mapped onto a 0–100 scale. `undefined` once both pipelines are terminal
	 * (or the crawl has failed — we hide the bar instead of stalling at a
	 * percentage that will never advance).
	 */
	progress: ProgressTick | undefined;
	/**
	 * Dated crawl versions for the reader bookmark, newest first; the first entry
	 * is the canonical/current version. `[]` hides the bookmark (article not yet
	 * crawled).
	 */
	crawlVersions: LocalTime[];
}

export interface ResolveReaderStateParams {
	article: ArticleSnapshot;
	pollUrlBuilder: PollUrlBuilder;
	capturing: boolean;
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
	pollCount: number;
	pollUrlBuilder: PollUrlBuilder;
	capturing: boolean;
	extensionInstallUrl: string | undefined;
	/**
	 * Per-poll tracking URL stamped on the re-rendered TL;DR `<details>` so the
	 * client beacon can report open/close toggles. `undefined` on the public
	 * /view and admin readers, which do not record anonymous summary toggles;
	 * `string` only on the internal /queue reader. Required (not optional) so
	 * each poll path makes the decision explicit, mirroring `extensionInstallUrl`.
	 */
	summaryToggleUrl: string | undefined;
}
