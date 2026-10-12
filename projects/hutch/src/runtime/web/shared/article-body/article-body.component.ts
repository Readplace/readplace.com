import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleDestinationUrl, DisplayableReadTime, SiteLabel } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { render } from "@packages/web-shell";
import { renderArticleHeader, type ReaderReadlistTags } from "./article-header/article-header.component";
import {
	type ArticleHistoryRemoval,
	renderArticleHistory,
	renderOfflineCopyTemplate,
} from "./article-history/article-history.component";
import type { ArticleVersion } from "../article-reader/article-reader.types";
import type { ReaderProvenance } from "./article-header/provenance-label";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import { renderReaderSlot } from "./reader-slot/reader-slot.component";
import { renderSummarySlot } from "./summary-slot/summary-slot.component";

const ARTICLE_BODY_TEMPLATE = readFileSync(
	join(__dirname, "article-body.template.html"),
	"utf-8",
);

const ARTICLE_RAIL_TEMPLATE = readFileSync(
	join(__dirname, "article-rail.template.html"),
	"utf-8",
);

export interface ArticleBodyInput {
	title: string;
	siteName: SiteLabel;
	readTime: DisplayableReadTime | undefined;
	url: ArticleDestinationUrl;
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
	topActionsHtml: string;
	bottomActionsHtml: string;
	extensionInstallUrl?: string;
	appOrigin: string;
	/** Where the owner's save came from. Per-user, so only the owner reader
	 * passes it; the public `/view` and the admin recrawl omit it. */
	provenance?: ReaderProvenance;
	saved: LocalTime | undefined;
	readlistTags?: ReaderReadlistTags;
	readerNotice?: ReaderFailedVariant;
	issueLinksHtml?: string;
}

export interface ArticleRailInput {
	crawlVersions?: ArticleVersion[];
	/** Owner-only removal controls. Present only on the
	 * authenticated owner reader; omitted on the public `/view` and iOS renders. */
	articleHistoryRemoval?: ArticleHistoryRemoval;
	offlineCopyRow?: boolean;
	/** Pre-rendered "Previously read on this topic" section. Owner-reader only —
	 * the public `/view` and the admin recrawl leave it unset, so reading history
	 * never appears there. */
	previouslyReadHtml?: string;
}

export function renderArticleRail(input: ArticleRailInput): string {
	return render(ARTICLE_RAIL_TEMPLATE, {
		articleHistoryHtml: renderArticleHistory({
			versions: input.crawlVersions ?? [],
			removal: input.articleHistoryRemoval,
		}),
		offlineCopyTemplateHtml: input.offlineCopyRow ? renderOfflineCopyTemplate() : "",
		previouslyReadHtml: input.previouslyReadHtml ?? "",
	}).trim();
}

export function renderArticleBody(input: ArticleBodyInput): string {
	const readerRegions = renderReaderSlot({
		crawl: input.crawl,
		content: input.content,
		url: input.url,
		readerPollUrl: input.readerPollUrl,
		capturePollUrl: input.capturePollUrl,
		extensionInstallUrl: input.extensionInstallUrl,
		notice: input.readerNotice,
		appOrigin: input.appOrigin,
		noticeOob: false,
	});

	const summarySlotHtml = renderSummarySlot({
		crawl: input.crawl,
		summary: input.summary,
		summaryPollUrl: input.summaryPollUrl,
		summaryOpen: input.summaryOpen,
		summaryToggleUrl: input.summaryToggleUrl,
		content: input.content,
	});

	const headerHtml = renderArticleHeader({
		title: input.title,
		siteName: input.siteName,
		readTime: input.readTime,
		url: input.url,
		provenance: input.provenance,
		readlistTags: input.readlistTags,
		saved: input.saved,
	});

	return render(ARTICLE_BODY_TEMPLATE, {
		topActionsHtml: input.topActionsHtml,
		headerHtml,
		readerSlotHtml: readerRegions.slot,
		readerNoticeHtml: readerRegions.notice,
		summarySlotHtml,
		issueLinksHtml: input.issueLinksHtml ?? "",
		bottomActionsHtml: input.bottomActionsHtml,
	});
}
