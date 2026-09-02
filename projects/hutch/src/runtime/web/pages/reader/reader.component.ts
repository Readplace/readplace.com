import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_HIDE_SCRIPT, readerScripts } from "../../shared/reader-nav-script";
import type { ArticleStatus, SavedArticle } from "@packages/domain/article";
import { nextReadDismissalOf } from "@packages/domain/article";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { pickExcerpt, truncateForSeo } from "../../../providers/article-summary/article-summary.helpers";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { RelatedArticles } from "@packages/provider-contracts/related-articles";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { renderArticleBody } from "../../shared/article-body/article-body.component";
import type {
	MarkReadAction,
	RenderReaderActions,
} from "../../shared/article-body/reader-actions/reader-actions.component";
import type { ReaderReadlistFiling } from "../readlist/reader-readlist-filing";
import {
	markStatusConfirmPopoverId,
	renderMarkStatusConfirm,
} from "../readlist/mark-status-confirm.component";
import { CRAWL_BOOKMARK_SCRIPT, type CrawlBookmarkRemoval } from "../../shared/article-body/crawl-bookmark/crawl-bookmark.component";
import type { ProgressTick } from "@packages/domain/article";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import {
	NEXT_READ_SCRIPT,
	renderNextRead,
} from "../../shared/next-read/next-read.component";
import {
	SHARE_BALLOON_SCRIPT,
	renderShareBalloon,
} from "../../shared/share-balloon/share-balloon.component";
import { viewPathFor } from "../view/view-path";
import { renderExitConfirm } from "./reader-exit-confirm.component";
import { READER_STYLES } from "./reader.styles";
import { displayableReadTime } from "@packages/domain/article";

const READER_TEMPLATE = readFileSync(join(__dirname, "reader.template.html"), "utf-8");
const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;
const SUMMARY_TOGGLE_SCRIPT = `<script src="/client-dist/summary-toggle.client.js" defer></script>`;
const READER_EXIT_CONFIRM_SCRIPT = `<script src="/client-dist/reader-exit-confirm.client.js" defer></script>`;

/**
 * Both the initial SSR <title> and the OOB <title> swap emitted by reader
 * polls have to use the same format — otherwise the browser tab flickers
 * between formats every time the title settles after a crawl completes.
 * Exported so the queue route can hand it to initArticleReader.
 */
export function formatReaderDocumentTitle(articleTitle: string): string {
	return `${articleTitle} — Readplace Reader`;
}

function markReadPostUrl({
	articleId,
	utmContent,
}: { articleId: string; utmContent: string }): string {
	const params = new URLSearchParams([
		["utm_source", "reader"],
		["utm_medium", "internal"],
		["utm_content", utmContent],
	]);
	return `/queue/${articleId}/status?${params.toString()}`;
}

function buildExitConfirmHtml(input: {
	enabled: boolean;
	isRead: boolean;
	articleId: string;
	title: string;
}): string {
	if (!input.enabled) return "";
	if (input.isRead) return "";
	return renderExitConfirm({
		title: input.title,
		postUrl: markReadPostUrl({ articleId: input.articleId, utmContent: "mark-read-exit" }),
	});
}

export function ReaderPage(
	article: SavedArticle,
	options: {
		appOrigin: string;
		summary?: GeneratedSummary;
		summaryPollUrl?: string;
		crawl?: ArticleCrawl;
		readerPollUrl?: string;
		capturePollUrl?: string;
		progress?: ProgressTick;
		related?: RelatedArticles;
		relatedPollUrl?: string;
		currentPath: string;
		now: Date;
		extensionInstallUrl?: string;
		backLink: { topHref: string; label: string };
		/** Injected per variant: the sticky action toolbar (Back + Mark-as-read, no
		 * bottom bar) for the web reader or the iOS chromeless reader. Both render the
		 * same toolbar; the variant carries the page body class that decides where it
		 * pins, so the markup and the CSS that pins it can never drift apart. */
		renderActions: RenderReaderActions;
		readlistFiling: ReaderReadlistFiling;
		crawlVersions?: LocalTime[];
		crawlBookmarkRemoval?: CrawlBookmarkRemoval;
		exitMarkReadConfirm?: boolean;
		markStatusConfirmReadlistLabels?: readonly string[];
		readerNotice?: ReaderFailedVariant;
		epubDownloadHref?: string;
	},
): PageBody {
	const articleId = article.id.value;
	const isRead = article.status === "read";
	const markReadLabel = isRead ? "Mark as unread" : "Mark as read";
	const markReadStatus: ArticleStatus = isRead ? "unread" : "read";
	const markStatusConfirm =
		options.markStatusConfirmReadlistLabels === undefined
			? undefined
			: {
					articleId,
					popoverId: markStatusConfirmPopoverId(articleId),
					url: `/queue/${articleId}/status`,
					status: markReadStatus,
					queueLabels: options.markStatusConfirmReadlistLabels,
				};
	const markReadActions: MarkReadAction[] = [
		{
			position: "top",
			postUrl: markReadPostUrl({ articleId, utmContent: "mark-read-top" }),
			label: markReadLabel,
			testAction: `mark-${markReadStatus}`,
			fields: [{ name: "status", value: markReadStatus }],
			...(markStatusConfirm === undefined
				? {}
				: { confirmPopoverId: markStatusConfirm.popoverId }),
		},
	];
	const actions = options.renderActions({
		actionBtns: {
			backLink: options.backLink,
			markReadActions,
			readlistPicker: options.readlistFiling.picker,
			epubDownload:
				options.epubDownloadHref === undefined ? undefined : { href: options.epubDownloadHref },
		},
	});
	const innerContent = renderArticleBody({
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		readTime: displayableReadTime(article),
		// Header "View original" points at the redirect destination once merged;
		// the share path below stays on `article.url` (the /view identity).
		url: article.displayUrl ?? article.url,
		provenance: article.provenance,
		readlistTags: options.readlistFiling.tags,
		content: article.content,
		crawl: options.crawl,
		readerPollUrl: options.readerPollUrl,
		capturePollUrl: options.capturePollUrl,
		summary: options.summary,
		summaryPollUrl: options.summaryPollUrl,
		summaryOpen: false,
		summaryToggleUrl: `/queue/${articleId}/summary-toggle`,
		progress: options.progress,
		appOrigin: options.appOrigin,
		topActionsHtml: actions.top.to("text/html").body,
		bottomActionsHtml: actions.bottom.to("text/html").body,
		crawlVersions: options.crawlVersions,
		crawlBookmarkRemoval: options.crawlBookmarkRemoval,
		extensionInstallUrl: options.extensionInstallUrl,
		readerNotice: options.readerNotice,
	});
	const shareBalloon = renderShareBalloon({
		shareUrl: `${options.appOrigin}${viewPathFor(article.url)}`,
		shareTitle: article.metadata.title,
		shareHint: "Click here to share this post!",
		shareSource: "reader-internal",
	});
	const nextRead = renderNextRead({
		related: options.related
			? {
					articles: options.related,
					sourceArticleId: articleId,
					now: options.now,
					dismissal: nextReadDismissalOf(article),
				}
			: undefined,
		pollUrl: options.relatedPollUrl,
		returnTo: options.currentPath,
	});
	const exitMarkReadConfirm = options.exitMarkReadConfirm === true;
	const exitConfirmHtml = buildExitConfirmHtml({
		enabled: exitMarkReadConfirm,
		isRead,
		articleId,
		title: article.metadata.title,
	});
	const markStatusConfirmHtml =
		markStatusConfirm === undefined
			? ""
			: renderMarkStatusConfirm({ confirm: markStatusConfirm, source: "reader" });
	const content = render(READER_TEMPLATE, {
		innerContent,
		shareBalloon,
		nextRead,
		exitConfirmHtml,
		markStatusConfirmHtml,
	});

	return {
		seo: {
			title: formatReaderDocumentTitle(article.metadata.title),
			description: truncateForSeo(pickExcerpt(options.summary, article.metadata.excerpt).text),
			canonicalUrl: `/queue/${articleId}/view`,
			robots: "noindex, nofollow",
		},
		styles: READER_STYLES,
		bodyClass: actions.bodyClass,
		content: { html: content },
		scripts: readerScripts({
			navHide: NAV_HIDE_SCRIPT,
			page:
				SHARE_BALLOON_SCRIPT +
				NEXT_READ_SCRIPT +
				PROGRESS_BAR_SCRIPT +
				SUMMARY_TOGGLE_SCRIPT +
				CRAWL_BOOKMARK_SCRIPT +
				(exitMarkReadConfirm ? READER_EXIT_CONFIRM_SCRIPT : ""),
		}),
	};
}
