import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { PageBody } from "@packages/web-shell";
import { NAV_HIDE_SCRIPT, readerScripts } from "../../shared/reader-nav-script";
import { renderArticleBody } from "../../shared/article-body/article-body.component";
import { RegularReader } from "../../shared/article-body/reader-actions/reader-actions.component";
import { CRAWL_BOOKMARK_SCRIPT } from "../../shared/article-body/crawl-bookmark/crawl-bookmark.component";
import type { ProgressTick } from "@packages/domain/article";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import { RECRAWL_STYLES } from "./recrawl.styles";

/**
 * The page's own address for an article, and the form tooling should emit.
 * `?url=` is the only carrier that can name every stored row: the edge decodes
 * `%2F` and collapses `//` before Express sees a *path*, and only a leading
 * scheme survives that — an embedded one (`…/web/<ts>/https://site/x`, the shape
 * wayback captures carry) arrives as `https:/` and resolves to a different
 * DynamoDB row, so a recrawl silently heals the wrong article. Query values are
 * not path-normalised. The path form stays supported for hand-typed URLs.
 */
export function recrawlPathFor(articleUrl: string): string {
	return `/admin/recrawl?url=${encodeURIComponent(articleUrl)}`;
}

const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;

// POST-Redirect-GET: the recrawl is a state mutation, so the operator's
// browser submits it via POST instead of firing it on the read-only GET.
const RECRAWL_TRIGGER_SCRIPT = `
<script>
	(function () {
		function run() {
			var form = document.querySelector('[data-auto-submit]');
			if (form) form.requestSubmit();
		}
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', run, { once: true });
		} else {
			run();
		}
	})();
</script>
`;

function renderRecrawlForm(action: string | undefined): string {
	if (action === undefined) {
		return "";
	}
	return `<form method="POST" action="${action}" data-auto-submit data-test-admin-recrawl-trigger></form>`;
}

/**
 * Both the initial SSR <title> and the OOB <title> swap emitted by recrawl
 * polls have to use the same format — otherwise the browser tab flickers
 * between formats every time the title settles after a recrawl completes.
 * Exported so the recrawl route can hand it to initArticleReader.
 */
export function formatRecrawlDocumentTitle(articleTitle: string): string {
	return `Admin recrawl: ${articleTitle}`;
}

export interface AdminRecrawlPageInput {
	articleUrl: string;
	metadata: ArticleMetadata;
	estimatedReadTime: Minutes;
	content?: string;
	crawl?: ArticleCrawl;
	readerPollUrl?: string;
	summary?: GeneratedSummary;
	summaryPollUrl?: string;
	progress?: ProgressTick;
	contentSourceTier?: "tier-0" | "tier-1";
	extensionInstallUrl?: string;
	appOrigin: string;
	recrawlFormAction?: string;
	crawlVersions?: LocalTime[];
}

/**
 * Admin recrawl page. Renders the same article-body used by /view (title,
 * meta, summary slot, reader slot, poll-based reveal), but intentionally
 * drops the /view clutter — share balloon, CTA actions. Admin pages are
 * noindex/nofollow and served Cache-Control: no-store by the handler.
 *
 * The tier badge surfaces which tier won the most recent selector contest
 * so an operator can see, after a recrawl, whether the AI selector kept the
 * extension-captured Tier 0 source over the freshly-fetched Tier 1 (e.g.
 * when the origin is paywalled and the HTTP path produced inferior content).
 * Rows written before the selector existed have no `contentSourceTier`
 * column and surface as "(legacy)".
 */
export function AdminRecrawlPage(input: AdminRecrawlPageInput): PageBody {
	const actions = RegularReader({ actionBtns: {} });
	const innerContent = renderArticleBody({
		title: input.metadata.title,
		siteName: input.metadata.siteName,
		estimatedReadTime: input.estimatedReadTime,
		url: input.articleUrl,
		content: input.content,
		crawl: input.crawl,
		readerPollUrl: input.readerPollUrl,
		summary: input.summary,
		summaryPollUrl: input.summaryPollUrl,
		summaryOpen: false,
		progress: input.progress,
		extensionInstallUrl: input.extensionInstallUrl,
		appOrigin: input.appOrigin,
		topActionsHtml: actions.top.to("text/html").body,
		bottomActionsHtml: actions.bottom.to("text/html").body,
		crawlVersions: input.crawlVersions,
	});

	const tierBadge = renderTierBadge(input.contentSourceTier);
	const recrawlForm = renderRecrawlForm(input.recrawlFormAction);
	const content = `<main class="admin-recrawl" data-test-admin-recrawl>${tierBadge}${recrawlForm}<article class="admin-recrawl__body" data-article-body>${innerContent}</article></main>`;
	const triggerScript =
		input.recrawlFormAction === undefined ? "" : RECRAWL_TRIGGER_SCRIPT;

	return {
		seo: {
			title: formatRecrawlDocumentTitle(input.metadata.title),
			description: "Operator recrawl view. Not for public consumption.",
			canonicalUrl: recrawlPathFor(input.articleUrl),
			robots: "noindex, nofollow",
		},
		styles: RECRAWL_STYLES,
		bodyClass: "page-admin-recrawl",
		content: { html: content },
		scripts: readerScripts({
			navHide: NAV_HIDE_SCRIPT,
			page: PROGRESS_BAR_SCRIPT + CRAWL_BOOKMARK_SCRIPT + triggerScript,
		}),
	};
}

function renderTierBadge(tier: "tier-0" | "tier-1" | undefined): string {
	if (tier === "tier-0") {
		return `<div class="admin-recrawl__tier-badge" data-test-tier-badge="tier-0">Showing Tier 0 (extension capture)</div>`;
	}
	if (tier === "tier-1") {
		return `<div class="admin-recrawl__tier-badge" data-test-tier-badge="tier-1">Showing Tier 1 (HTTP crawl)</div>`;
	}
	return `<div class="admin-recrawl__tier-badge admin-recrawl__tier-badge--legacy" data-test-tier-badge="legacy">Showing Tier 1 (legacy)</div>`;
}
