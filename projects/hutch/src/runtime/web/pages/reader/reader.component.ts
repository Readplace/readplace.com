import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_HIDE_DISABLED, readerScripts } from "../../shared/reader-nav-script";
import type { ArticleBody, ArticleStatus, SavedArticle } from "@packages/domain/article";
import { nextReadDismissalOf } from "@packages/domain/article";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { pickExcerpt, truncateForSeo } from "../../../providers/article-summary/article-summary.helpers";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type {
	PastReads,
	RelatedArticles,
} from "@packages/provider-contracts/related-articles";
import type { ReadlistRef, ReadlistSlug } from "@packages/domain/readlist";
import { render, toRelativeOrDate, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { renderArticleBody, renderArticleRail } from "../../shared/article-body/article-body.component";
import type { ReaderProvenance } from "../../shared/article-body/article-header/provenance-label";
import {
	type MarkReadAction,
	READLIST_PICKER_SCRIPT,
	type RenderReaderActions,
} from "../../shared/article-body/reader-actions/reader-actions.component";
import type { ReaderReadlistFiling } from "../readlist/reader-readlist-filing";
import {
	markStatusConfirmPopoverId,
	renderMarkStatusConfirm,
} from "../readlist/mark-status-confirm.component";
import type { ArticleHistoryRemoval } from "../../shared/article-body/article-history/article-history.component";
import type { ArticleVersion, CapturePollUrls } from "../../shared/article-reader/article-reader.types";
import { CAPTURE_FAILED_RELAY_SCRIPT } from "../../shared/article-body/reader-slot/reader-slot.component";
import { SUMMARY_TOGGLE_SCRIPT } from "../../shared/article-body/summary-slot/summary-slot.component";
import {
	TABLE_OF_CONTENTS_SCRIPT,
	isTableOfContentsVisible,
} from "../../shared/article-body/table-of-contents/table-of-contents.component";
import { renderDownloadGuideDialog } from "../../shared/download-guide/download-guide.component";
import type { EpubDownloadGuide } from "../../shared/epub/epub-download-guide";
import { railLandmarkFor } from "../../shared/reading-layout/rail-landmark";
import { READER_OPEN_SCRIPT } from "../../shared/reader-open/reader-open-script";
import { renderNextRead } from "../../shared/next-read/next-read.component";
import {
	type PastReadsSectionInput,
	hasVisiblePastReads,
	renderPastReadsSection,
} from "../../shared/past-reads/past-reads.component";
import { type IssueLinksSectionInput, renderIssueLinksSection } from "../../shared/issue-links/issue-links.component";
import {
	SHARE_DIALOG_POPOVER_ID,
	SHARE_DIALOG_SCRIPT,
	renderShareDialog,
	renderSharePanel,
} from "../../shared/share-dialog/share-dialog.component";
import { renderReadlistCreate } from "../readlist/readlist-create.component";
import { READLIST_CLIENT_SCRIPT } from "../readlist/readlist-name-form.component";
import { renderFilingToast } from "../readlist/readlist-mutation-fragments";
import { viewPathFor } from "../view/view-path";
import {
	type ExitConfirmScopes,
	READER_EXIT_CONFIRM_SCRIPT,
	renderExitConfirm,
} from "./reader-exit-confirm.component";
import { READER_TOP_SCRIPT } from "./reader-top-script";
import { READER_STYLES } from "./reader.styles";
import { displayableReadTime } from "@packages/domain/article";
import { parseEmailIssueArticleUrl } from "@packages/domain/inbox";
import { reportArticleHref } from "../../shared/report-article/report-article-href";

const READER_TEMPLATE = readFileSync(join(__dirname, "reader.template.html"), "utf-8");

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
	return withInternalTracking(`/queue/${articleId}/status`, { source: "reader", content: utmContent });
}

function buildExitConfirmHtml(input: {
	scopes: ExitConfirmScopes | undefined;
	isRead: boolean;
	articleId: string;
	title: string;
}): string {
	const scopes = input.scopes;
	if (scopes === undefined) return "";
	if (input.isRead) return "";
	return renderExitConfirm({
		title: input.title,
		postUrl: markReadPostUrl({ articleId: input.articleId, utmContent: "mark-read-exit" }),
		scopes,
	});
}

export function ReaderPage(
	article: SavedArticle,
	options: {
		appOrigin: string;
		content: ArticleBody | undefined;
		summary?: GeneratedSummary;
		summaryPollUrl?: string;
		crawl?: ArticleCrawl;
		readerPollUrl?: string;
		capturePollUrls?: CapturePollUrls;
		related?: RelatedArticles;
		relatedPollUrl?: string;
		previouslyRead?: PastReads;
		previouslyReadPollUrl?: string;
		previouslyReadComputeUrl?: string;
		readerPathForReadlist?: (
			articleId: string,
			readlist?: ReadlistSlug,
		) => string;
		currentPath: string;
		now: Date;
		extensionInstallUrl?: string;
		backLink: { topHref: string; label: string };
		renderActions: RenderReaderActions;
		readlistFiling: ReaderReadlistFiling;
		crawlVersions?: ArticleVersion[];
		articleHistoryRemoval?: ArticleHistoryRemoval;
		offlineCopyRow?: boolean;
		exitConfirmScopes?: ExitConfirmScopes;
		readerPathFor: (articleId: string) => string;
		markStatusConfirmReadlists?: readonly ReadlistRef[];
		readerNotice?: ReaderFailedVariant;
		epubDownloadHref?: string;
		epubDownloadGuide?: EpubDownloadGuide;
		provenance: ReaderProvenance | undefined;
		issueLinks?: IssueLinksSectionInput;
	},
): PageBody {
	const articleId = article.id.value;
	const isRead = article.status === "read";
	const markReadLabel = isRead ? "Mark as unread" : "Mark as read";
	const markReadIcon = isRead ? "inbox" : "check";
	const markReadStatus: ArticleStatus = isRead ? "unread" : "read";
	const markStatusConfirm =
		options.markStatusConfirmReadlists === undefined
			? undefined
			: {
					articleId,
					popoverId: markStatusConfirmPopoverId(articleId),
					url: `/queue/${articleId}/status`,
					status: markReadStatus,
					readlists: options.markStatusConfirmReadlists,
				};
	const markReadActions: MarkReadAction[] = [
		{
			position: "top",
			postUrl: markReadPostUrl({ articleId, utmContent: isRead ? "mark-unread-top" : "mark-read-top" }),
			label: markReadLabel,
			iconName: markReadIcon,
			testAction: `mark-${markReadStatus}`,
			fields: [{ name: "status", value: markReadStatus }],
			...(markStatusConfirm === undefined
				? {}
				: { confirmPopoverId: markStatusConfirm.popoverId }),
		},
	];
	const isPrivateIssue = parseEmailIssueArticleUrl(article.url) !== undefined;
	const share = {
		shareUrl: `${options.appOrigin}${viewPathFor(article.url)}`,
		title: article.metadata.title,
		campaign: "reader-internal",
	} as const;
	const picker = options.readlistFiling.picker;
	const actions = options.renderActions({
		actionBtns: {
			backLink: options.backLink,
			markReadActions,
			readlistPicker: picker,
			share: isPrivateIssue
				? undefined
				: { popoverId: SHARE_DIALOG_POPOVER_ID, fallbackHtml: renderSharePanel(share) },
			epubDownloadHref: options.epubDownloadHref,
			epubDownloadGuide: options.epubDownloadGuide,
		},
	});
	const pastReadsInput: PastReadsSectionInput | undefined =
		options.readerPathForReadlist === undefined
			? undefined
			: {
					pastReads: options.previouslyRead,
					sourceArticleId: articleId,
					now: options.now,
					readerPathForReadlist: options.readerPathForReadlist,
				};
	const railLandmark = railLandmarkFor({
		hasCard:
			(options.crawlVersions ?? []).length > 0 ||
			(pastReadsInput !== undefined && hasVisiblePastReads(pastReadsInput)) ||
			isTableOfContentsVisible({
				crawl: options.crawl,
				content: options.content,
				notice: options.readerNotice,
			}),
	});
	const railHtml = renderArticleRail({
		title: article.metadata.title,
		crawl: options.crawl,
		content: options.content,
		readerNotice: options.readerNotice,
		appOrigin: options.appOrigin,
		crawlVersions: options.crawlVersions,
		articleHistoryRemoval: options.articleHistoryRemoval,
		offlineCopyRow: options.offlineCopyRow,
		previouslyReadHtml:
			pastReadsInput === undefined
				? undefined
				: renderPastReadsSection({
						...pastReadsInput,
						placement: {
							kind: "rail",
							pollUrl: options.previouslyReadPollUrl,
							computeUrl: options.previouslyReadComputeUrl,
						},
					}),
	});
	const innerContent = renderArticleBody({
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		readTime: displayableReadTime(article),
		url: article.destinationUrl,
		articleId,
		provenance: options.provenance,
		saved: toRelativeOrDate({ iso: article.savedAt.toISOString(), now: options.now }),
		publishedOn: article.metadata.publishedOn,
		readlistTags: options.readlistFiling.tags,
		content: options.content,
		crawl: options.crawl,
		readerPollUrl: options.readerPollUrl,
		capturePollUrls: options.capturePollUrls,
		summary: options.summary,
		summaryPollUrl: options.summaryPollUrl,
		summaryOpen: false,
		summaryToggleUrl: `/queue/${articleId}/summary-toggle`,
		appOrigin: options.appOrigin,
		topActionsHtml: actions.top.to("text/html").body,
		bottomActionsHtml: actions.bottom.to("text/html").body,
		extensionInstallUrl: options.extensionInstallUrl,
		readerNotice: options.readerNotice,
		issueLinksHtml: renderIssueLinksSection(options.issueLinks),
		reportHref: isPrivateIssue
			? undefined
			: reportArticleHref({ viewUrl: share.shareUrl, title: article.metadata.title }),
		previouslyReadHtml:
			pastReadsInput === undefined
				? undefined
				: renderPastReadsSection({
						...pastReadsInput,
						placement: { kind: "inline", oob: false, computeUrl: options.previouslyReadComputeUrl },
					}),
	});
	const shareDialogHtml = isPrivateIssue ? "" : renderShareDialog(share);
	const downloadGuideHtml =
		options.epubDownloadGuide === undefined ? "" : renderDownloadGuideDialog(options.epubDownloadGuide);
	const readlistCreateHtml =
		picker?.create === undefined
			? ""
			: renderReadlistCreate({
					popoverId: picker.create.popoverId,
					key: "readlist-create",
					action: picker.create.createUrl,
					hiddenFields: [{ name: "returnTo", value: picker.returnTo }],
				});
	const filingToast = options.readlistFiling.toast;
	const statusToastHtml = filingToast === undefined ? "" : renderFilingToast(filingToast);
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
		readerPathFor: options.readerPathFor,
	});
	const exitConfirmHtml = buildExitConfirmHtml({
		scopes: options.exitConfirmScopes,
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
		railLandmark,
		railHtml,
		nextRead,
		exitConfirmHtml,
		markStatusConfirmHtml,
		shareDialogHtml,
		downloadGuideHtml,
		readlistCreateHtml,
		statusToastHtml,
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
			navHide: NAV_HIDE_DISABLED,
			page:
				SHARE_DIALOG_SCRIPT +
				SUMMARY_TOGGLE_SCRIPT +
				CAPTURE_FAILED_RELAY_SCRIPT +
				READLIST_PICKER_SCRIPT +
				READLIST_CLIENT_SCRIPT +
				(options.exitConfirmScopes === undefined ? "" : READER_EXIT_CONFIRM_SCRIPT) +
				READER_OPEN_SCRIPT +
				READER_TOP_SCRIPT +
				TABLE_OF_CONTENTS_SCRIPT,
		}),
	};
}
