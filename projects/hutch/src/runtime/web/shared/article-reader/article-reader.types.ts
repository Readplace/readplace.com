import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
} from "@packages/test-fixtures/providers/article-crawl";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
} from "@packages/test-fixtures/providers/article-summary";
import type {
	FindArticleByUrl,
	ReadArticleContent,
} from "@packages/test-fixtures/providers/article-store";
import type { ProgressTick } from "@packages/domain/article";

export interface ArticleReaderDeps {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	findGeneratedSummary: FindGeneratedSummary;
	readArticleContent: ReadArticleContent;
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
	 * Static for a given reader (queue → /queue, view → none). Lives at init
	 * time, not per-poll, because it never changes during a reader session.
	 */
	backLink?: { href: string; label: string };
	now: () => Date;
}

export interface ArticleSnapshot {
	url: string;
	metadata: ArticleMetadata;
	estimatedReadTime: Minutes;
}

export interface PollUrlBuilder {
	summary: (pollCount: number) => string;
	reader: (pollCount: number) => string;
}

export interface ReaderState {
	content: string | undefined;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	readerPollUrl: string | undefined;
	summaryPollUrl: string | undefined;
	/**
	 * Single unified progress tick driving the article-body progress bar.
	 * Computed from whichever pipeline (crawl → summary) is currently in flight,
	 * mapped onto a 0–100 scale. `undefined` once both pipelines are terminal
	 * (or the crawl has failed — we hide the bar instead of stalling at a
	 * percentage that will never advance).
	 */
	progress: ProgressTick | undefined;
}

export interface ResolveReaderStateParams {
	article: ArticleSnapshot;
	pollUrlBuilder: PollUrlBuilder;
}

export interface HandlePollParams {
	articleUrl: string;
	pollCount: number;
	pollUrlBuilder: PollUrlBuilder;
	extensionInstallUrl?: string;
}
