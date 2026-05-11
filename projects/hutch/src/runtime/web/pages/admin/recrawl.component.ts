import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import type { PageBody } from "../../page-body.types";
import { renderArticleBody } from "../../shared/article-body/article-body.component";
import type { ProgressTick } from "@packages/domain/article";
import { RECRAWL_STYLES } from "./recrawl.styles";

const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;

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
		summaryOpen: true,
		progress: input.progress,
		extensionInstallUrl: input.extensionInstallUrl,
	});

	const tierBadge = renderTierBadge(input.contentSourceTier);
	const content = `<main class="admin-recrawl" data-test-admin-recrawl>${tierBadge}<article class="admin-recrawl__body">${innerContent}</article></main>`;

	return {
		seo: {
			title: formatRecrawlDocumentTitle(input.metadata.title),
			description: "Operator recrawl view. Not for public consumption.",
			canonicalUrl: `/admin/recrawl/${encodeURIComponent(input.articleUrl)}`,
			robots: "noindex, nofollow",
		},
		styles: RECRAWL_STYLES,
		bodyClass: "page-admin-recrawl",
		content: { html: content },
		scripts: PROGRESS_BAR_SCRIPT,
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
