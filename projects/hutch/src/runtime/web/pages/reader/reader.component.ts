import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_HIDE_SCRIPT, readerScripts } from "../../shared/reader-nav-script";
import type { SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { pickExcerpt, truncateForSeo } from "../../../providers/article-summary/article-summary.helpers";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { renderArticleBody } from "../../shared/article-body/article-body.component";
import type {
	MarkReadAction,
	RenderReaderActions,
} from "../../shared/article-body/reader-actions/reader-actions.component";
import { CRAWL_BOOKMARK_SCRIPT } from "../../shared/article-body/crawl-bookmark/crawl-bookmark.component";
import type { ProgressTick } from "@packages/domain/article";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import {
	SHARE_BALLOON_SCRIPT,
	renderShareBalloon,
} from "../../shared/share-balloon/share-balloon.component";
import { shareUserIdPrefix } from "../../shared/share-balloon/share-user-id-prefix";
import { viewPathFor } from "../view/view-path";
import { READER_STYLES } from "./reader.styles";

const READER_TEMPLATE = readFileSync(join(__dirname, "reader.template.html"), "utf-8");
const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;
const READER_IFRAME_SCRIPT = `<script src="/client-dist/reader-iframe.client.js" defer></script>`;
const SUMMARY_TOGGLE_SCRIPT = `<script src="/client-dist/summary-toggle.client.js" defer></script>`;

/**
 * Both the initial SSR <title> and the OOB <title> swap emitted by reader
 * polls have to use the same format — otherwise the browser tab flickers
 * between formats every time the title settles after a crawl completes.
 * Exported so the queue route can hand it to initArticleReader.
 */
export function formatReaderDocumentTitle(articleTitle: string): string {
	return `${articleTitle} — Readplace Reader`;
}

function markReadPostUrl(articleId: string): string {
	const params = new URLSearchParams([
		["utm_source", "reader"],
		["utm_medium", "internal"],
		["utm_content", "mark-read-top"],
	]);
	return `/queue/${articleId}/status?${params.toString()}`;
}

export function ReaderPage(
	article: SavedArticle,
	options: {
		appOrigin: string;
		summary?: GeneratedSummary;
		summaryPollUrl?: string;
		crawl?: ArticleCrawl;
		readerPollUrl?: string;
		progress?: ProgressTick;
		audioEnabled?: boolean;
		extensionInstallUrl?: string;
		backLink: { topHref: string; label: string };
		/** Injected per variant: the sticky action toolbar (Back + Mark-as-read, no
		 * bottom bar) for the web reader or the iOS chromeless reader. Both render the
		 * same toolbar; the variant carries the page body class that decides where it
		 * pins, so the markup and the CSS that pins it can never drift apart. */
		renderActions: RenderReaderActions;
		crawlVersions?: LocalTime[];
	},
): PageBody {
	const articleId = article.id.value;
	const isRead = article.status === "read";
	const markReadLabel = isRead ? "Mark as unread" : "Mark as read";
	const markReadStatus = isRead ? "unread" : "read";
	const markReadActions: MarkReadAction[] = [
		{
			position: "top",
			postUrl: markReadPostUrl(articleId),
			label: markReadLabel,
			fields: [{ name: "status", value: markReadStatus }],
		},
	];
	const actions = options.renderActions({ actionBtns: { backLink: options.backLink, markReadActions } });
	const innerContent = renderArticleBody({
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		estimatedReadTime: article.estimatedReadTime,
		url: article.url,
		content: article.content,
		crawl: options.crawl,
		readerPollUrl: options.readerPollUrl,
		summary: options.summary,
		summaryPollUrl: options.summaryPollUrl,
		summaryOpen: false,
		summaryToggleUrl: `/queue/${articleId}/summary-toggle`,
		progress: options.progress,
		audioEnabled: options.audioEnabled,
		appOrigin: options.appOrigin,
		topActionsHtml: actions.top.to("text/html").body,
		bottomActionsHtml: actions.bottom.to("text/html").body,
		crawlVersions: options.crawlVersions,
		extensionInstallUrl: options.extensionInstallUrl,
	});
	const shareBalloon = renderShareBalloon({
		shareUrl: `${options.appOrigin}${viewPathFor(article.url)}`,
		shareTitle: article.metadata.title,
		shareHint: "Click here to share this post!",
		shareSource: "reader-internal",
		sharerUserIdPrefix: shareUserIdPrefix(article.userId),
	});
	const content = render(READER_TEMPLATE, { innerContent, shareBalloon });

	return {
		seo: {
			title: formatReaderDocumentTitle(article.metadata.title),
			description: truncateForSeo(pickExcerpt(options.summary, article.metadata.excerpt)),
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
				PROGRESS_BAR_SCRIPT +
				READER_IFRAME_SCRIPT +
				SUMMARY_TOGGLE_SCRIPT +
				CRAWL_BOOKMARK_SCRIPT,
		}),
	};
}
