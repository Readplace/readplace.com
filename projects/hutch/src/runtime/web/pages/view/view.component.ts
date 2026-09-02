import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_HIDE_SCRIPT, readerScripts } from "../../shared/reader-nav-script";
import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { pickExcerpt, truncateForSeo } from "../../../providers/article-summary/article-summary.helpers";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { requireEnv } from "@packages/require-env";
import { CONFIRM_POPOVER_STYLES, render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { renderArticleBody } from "../../shared/article-body/article-body.component";
import { RegularReader } from "../../shared/article-body/reader-actions/reader-actions.component";
import { CRAWL_BOOKMARK_SCRIPT } from "../../shared/article-body/crawl-bookmark/crawl-bookmark.component";
import type { ProgressTick } from "@packages/domain/article";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import {
	SHARE_BALLOON_SCRIPT,
	renderShareBalloon,
} from "../../shared/share-balloon/share-balloon.component";
import { viewPathFor } from "./view-path";
import { SAVE_TIP_SCRIPT, type SaveTip } from "../../shared/save-tip/save-tip.component";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import { VIEW_STYLES } from "./view.styles";
import { displayableReadTime } from "@packages/domain/article";

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");
const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;

const DEFAULT_OG_IMAGE = `${STATIC_BASE_URL}/og-image-1200x630.png`;
const DEFAULT_TWITTER_IMAGE = `${STATIC_BASE_URL}/twitter-card-1200x600.png`;
const DEFAULT_OG_ALT = "Readplace — A read-it-later app";

/**
 * Both the initial SSR <title> and the OOB <title> swap emitted by view
 * polls have to use the same format — otherwise the browser tab flickers
 * between formats every time the title settles after a crawl completes.
 * Exported so the view route can hand it to initArticleReader.
 */
export function formatViewDocumentTitle(articleTitle: string): string {
	return `${articleTitle} | Reader View`;
}

const VIEW_TEMPLATE = readFileSync(
	join(__dirname, "view.template.html"),
	"utf-8",
);

const VIEW_CTA_ACTION_TEMPLATE = readFileSync(
	join(__dirname, "view-cta-action.template.html"),
	"utf-8",
);

export type ViewActionKey = "save" | "paste-another-link" | "download-epub";

export interface ViewAction {
	key: ViewActionKey;
	name: string;
	href: string;
	variant: "primary" | "secondary";
	/** Present on the action the save-tip panel holds back, so the client script
	 * can tell it apart from the actions it must leave alone. */
	saveTipState?: SaveTipState;
}

function renderViewCtaAction(action: ViewAction, oob: boolean): string {
	return render(VIEW_CTA_ACTION_TEMPLATE, {
		key: action.key,
		name: action.name,
		href: action.href,
		variant: action.variant,
		saveTipState: action.saveTipState,
		oob,
	});
}

export function renderViewCtaActionOob(action: ViewAction): string {
	return renderViewCtaAction(action, true);
}

export interface ViewPageInput {
	/** Identity: drives the /view share path, the save action, and SEO. */
	articleUrl: string;
	/** Redirect destination for a merged article; shown as the header "View
	 * original" in place of `articleUrl`. Absent on a normal article. */
	displayUrl?: string;
	appOrigin: string;
	metadata: ArticleMetadata;
	estimatedReadTime: Minutes;
	content?: string;
	crawl?: ArticleCrawl;
	readerPollUrl?: string;
	summary?: GeneratedSummary;
	summaryPollUrl?: string;
	progress?: ProgressTick;
	actions: ViewAction[];
	saveTip: SaveTip;
	extensionInstallUrl?: string;
	crawlVersions?: LocalTime[];
	readerNotice?: ReaderFailedVariant;
}

export function ViewPage(input: ViewPageInput): PageBody {
	const actions = RegularReader({ actionBtns: { readlistPicker: undefined } });
	const innerContent = renderArticleBody({
		title: input.metadata.title,
		siteName: input.metadata.siteName,
		readTime: displayableReadTime(input),
		// Header "View original" only; the share path, save action and SEO below
		// keep `articleUrl` (the identity).
		url: input.displayUrl ?? input.articleUrl,
		content: input.content,
		crawl: input.crawl,
		readerPollUrl: input.readerPollUrl,
		summary: input.summary,
		summaryPollUrl: input.summaryPollUrl,
		summaryOpen: true,
		progress: input.progress,
		extensionInstallUrl: input.extensionInstallUrl,
		appOrigin: input.appOrigin,
		topActionsHtml: actions.top.to("text/html").body,
		bottomActionsHtml: actions.bottom.to("text/html").body,
		crawlVersions: input.crawlVersions,
		readerNotice: input.readerNotice,
	});

	const viewPath = viewPathFor(input.articleUrl);
	const shareableViewUrl = `${input.appOrigin}${viewPath}`;

	const shareBalloon = renderShareBalloon({
		shareUrl: shareableViewUrl,
		shareTitle: input.metadata.title,
		shareHint: "Click here to share this view!",
		shareSource: "reader-public",
	});

	const content = render(VIEW_TEMPLATE, {
		innerContent,
		articleUrl: input.articleUrl,
		actions: input.actions.map((action) => ({
			html: renderViewCtaAction(action, false),
		})),
		saveTipHtml: input.saveTip.html,
		shareBalloon,
	});

	const ogImage = input.metadata.imageUrl ?? DEFAULT_OG_IMAGE;
	const twitterImage = input.metadata.imageUrl ?? DEFAULT_TWITTER_IMAGE;
	const ogImageAlt = input.metadata.imageUrl
		? input.metadata.title
		: DEFAULT_OG_ALT;
	const description = truncateForSeo(
		pickExcerpt(input.summary, input.metadata.excerpt).text || "View on Readplace.",
	);

	const structuredData: Record<string, unknown> = {
		"@context": "https://schema.org",
		"@type": "Article",
		headline: input.metadata.title,
		description: description,
		url: input.articleUrl,
	};
	if (input.metadata.imageUrl) {
		structuredData.image = input.metadata.imageUrl;
	}

	return {
		seo: {
			title: formatViewDocumentTitle(input.metadata.title),
			description,
			canonicalUrl: input.articleUrl,
			canonicalIsExternal: true,
			ogUrl: shareableViewUrl,
			ogType: "article",
			ogImage,
			ogImageAlt,
			twitterImage,
			structuredData: input.readerNotice === undefined ? [structuredData] : [],
		},
		styles: `${VIEW_STYLES}\n${CONFIRM_POPOVER_STYLES}`,
		bodyClass: "page-view",
		followsSystemTheme: true,
		content: { html: content },
		scripts: readerScripts({
			navHide: NAV_HIDE_SCRIPT,
			page:
				SHARE_BALLOON_SCRIPT +
				PROGRESS_BAR_SCRIPT +
				CRAWL_BOOKMARK_SCRIPT +
				SAVE_TIP_SCRIPT,
		}),
	};
}
