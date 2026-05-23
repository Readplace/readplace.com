import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { pickExcerpt, truncateForSeo } from "../../../providers/article-summary/article-summary.helpers";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { renderArticleBody } from "../../shared/article-body/article-body.component";
import type { ProgressTick } from "@packages/domain/article";
import {
	SHARE_BALLOON_SCRIPT,
	renderShareBalloon,
} from "../../shared/share-balloon/share-balloon.component";
import { READER_STYLES } from "./reader.styles";

const CANONICAL_BASE_URL = "https://readplace.com";

const READER_TEMPLATE = readFileSync(join(__dirname, "reader.template.html"), "utf-8");
const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;
const READER_IFRAME_SCRIPT = `<script src="/client-dist/reader-iframe.client.js" defer></script>`;

/**
 * Both the initial SSR <title> and the OOB <title> swap emitted by reader
 * polls have to use the same format — otherwise the browser tab flickers
 * between formats every time the title settles after a crawl completes.
 * Exported so the queue route can hand it to initArticleReader.
 */
export function formatReaderDocumentTitle(articleTitle: string): string {
	return `${articleTitle} — Readplace Reader`;
}

export function markReadPostUrl(articleId: string, slot: "top" | "bottom"): string {
	const params = new URLSearchParams([
		["utm_source", "reader"],
		["utm_medium", "internal"],
		["utm_content", `mark-read-${slot}`],
	]);
	return `/queue/${articleId}/status?${params.toString()}`;
}

export function ReaderPage(
	article: SavedArticle,
	options?: {
		summary?: GeneratedSummary;
		summaryPollUrl?: string;
		crawl?: ArticleCrawl;
		readerPollUrl?: string;
		progress?: ProgressTick;
		audioEnabled?: boolean;
		extensionInstallUrl?: string;
	},
): PageBody {
	const articleId = article.id.value;
	const innerContent = renderArticleBody({
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		estimatedReadTime: article.estimatedReadTime,
		url: article.url,
		content: article.content,
		crawl: options?.crawl,
		readerPollUrl: options?.readerPollUrl,
		summary: options?.summary,
		summaryPollUrl: options?.summaryPollUrl,
		summaryOpen: true,
		progress: options?.progress,
		audioEnabled: options?.audioEnabled,
		backLink: {
			topHref: "/queue?utm_source=reader&utm_medium=internal&utm_content=back-top",
			bottomHref: "/queue?utm_source=reader&utm_medium=internal&utm_content=back-bottom",
			label: "← Back to queue",
		},
		markReadActions: [
			{
				position: "top",
				postUrl: markReadPostUrl(articleId, "top"),
				label: "Mark as read",
				fields: [{ name: "status", value: "read" }],
			},
			{
				position: "bottom",
				postUrl: markReadPostUrl(articleId, "bottom"),
				label: "Mark as read",
				fields: [{ name: "status", value: "read" }],
			},
		],
		extensionInstallUrl: options?.extensionInstallUrl,
	});
	const shareBalloon = renderShareBalloon({
		shareUrl: `${CANONICAL_BASE_URL}/view/${encodeURIComponent(article.url)}`,
		shareTitle: article.metadata.title,
		shareHint: "Click here to share this post!",
		shareSource: "reader-internal",
	});
	const content = render(READER_TEMPLATE, { innerContent, shareBalloon });

	return {
		seo: {
			title: formatReaderDocumentTitle(article.metadata.title),
			description: truncateForSeo(pickExcerpt(options?.summary, article.metadata.excerpt)),
			canonicalUrl: `/queue/${articleId}/view`,
			robots: "noindex, nofollow",
		},
		styles: READER_STYLES,
		bodyClass: "page-reader",
		content: { html: content },
		scripts: SHARE_BALLOON_SCRIPT + PROGRESS_BAR_SCRIPT + READER_IFRAME_SCRIPT,
	};
}
