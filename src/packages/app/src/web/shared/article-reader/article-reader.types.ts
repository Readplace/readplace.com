import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
	MarkCrawlPending,
} from "@packages/test-fixtures/providers/article-crawl";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
	MarkSummaryPending,
} from "@packages/test-fixtures/providers/article-summary";
import type { ReadArticleContent } from "@packages/test-fixtures/providers/article-store";
import type { ProgressTick } from "@packages/domain/article";

export interface ArticleReaderDeps {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	readArticleContent: ReadArticleContent;
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
