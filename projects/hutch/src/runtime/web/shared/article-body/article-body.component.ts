import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Minutes } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { requireEnv } from "@packages/require-env";
import { render } from "@packages/web-shell";
import { renderArticleHeader } from "./article-header/article-header.component";
import { renderCrawlBookmark, type CrawlBookmarkRemoval } from "./crawl-bookmark/crawl-bookmark.component";
import { renderProgressBar } from "./progress-bar.component";
import type { ProgressTick, SaveProvenance } from "@packages/domain/article";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import { renderReaderSlot } from "./reader-slot/reader-slot.component";
import { renderRelatedSlot, type RelatedSlotContext } from "./related-slot/related-slot.component";
import { renderSummarySlot } from "./summary-slot/summary-slot.component";

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");

const ARTICLE_BODY_TEMPLATE = readFileSync(
	join(__dirname, "article-body.template.html"),
	"utf-8",
);

export interface ArticleBodyInput {
	title: string;
	siteName: string;
	estimatedReadTime: Minutes;
	url: string;
	content?: string;
	crawl?: ArticleCrawl;
	readerPollUrl?: string;
	capturePollUrl?: string;
	summary?: GeneratedSummary;
	summaryPollUrl?: string;
	summaryOpen?: boolean;
	/** Tracking URL forwarded to the ready TL;DR `<details>`. Present only on the
	 * internal reader, where summary open/close is recorded; omitted elsewhere. */
	summaryToggleUrl?: string;
	/** Per-user relations, so only the owner reader passes them: the public
	 * `/view` and the admin recrawl render another reader's page and get the
	 * hidden slot by omission. */
	related?: RelatedSlotContext;
	relatedPollUrl?: string;
	audioEnabled?: boolean;
	topActionsHtml: string;
	bottomActionsHtml: string;
	extensionInstallUrl?: string;
	/**
	 * Single unified progress tick. When omitted (everything terminal, or
	 * crawl-failed) the bar still renders but in its hidden state so OOB
	 * progress-bar swaps from poll responses remain valid even when the
	 * initial SSR bar was hidden.
	 */
	progress?: ProgressTick;
	appOrigin: string;
	crawlVersions?: LocalTime[];
	/** Owner-only removal controls for the crawl bookmark. Present only on the
	 * authenticated owner reader; omitted on the public `/view` and iOS renders. */
	crawlBookmarkRemoval?: CrawlBookmarkRemoval;
	/** Where the owner's save came from. Per-user, so only the owner reader
	 * passes it; the public `/view` and the admin recrawl omit it. */
	provenance?: SaveProvenance;
}

export function renderArticleBody(input: ArticleBodyInput): string {
	const readerSlotHtml = renderReaderSlot({
		crawl: input.crawl,
		content: input.content,
		url: input.url,
		readerPollUrl: input.readerPollUrl,
		capturePollUrl: input.capturePollUrl,
		extensionInstallUrl: input.extensionInstallUrl,
		appOrigin: input.appOrigin,
	});

	const summarySlotHtml = renderSummarySlot({
		crawl: input.crawl,
		summary: input.summary,
		summaryPollUrl: input.summaryPollUrl,
		summaryOpen: input.summaryOpen,
		summaryToggleUrl: input.summaryToggleUrl,
		content: input.content,
	});

	const relatedSlotHtml = renderRelatedSlot({
		related: input.related,
		pollUrl: input.relatedPollUrl,
	});

	const progressBarHtml = renderProgressBar({ progress: input.progress });

	const crawlBookmarkHtml = renderCrawlBookmark({
		versions: input.crawlVersions ?? [],
		removal: input.crawlBookmarkRemoval,
	});

	const headerHtml = renderArticleHeader({
		title: input.title,
		siteName: input.siteName,
		estimatedReadTime: input.estimatedReadTime,
		url: input.url,
		provenance: input.provenance,
	});

	return render(ARTICLE_BODY_TEMPLATE, {
		topActionsHtml: input.topActionsHtml,
		headerHtml,
		readerSlotHtml,
		summarySlotHtml,
		relatedSlotHtml,
		progressBarHtml,
		crawlBookmarkHtml,
		audioEnabled: input.audioEnabled,
		staticBaseUrl: STATIC_BASE_URL,
		bottomActionsHtml: input.bottomActionsHtml,
	});
}
