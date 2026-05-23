import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { pickExcerpt, truncateForSeo } from "../../../providers/article-summary/article-summary.helpers";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { requireEnv } from "../../../domain/require-env";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { renderArticleBody } from "../../shared/article-body/article-body.component";
import type { ProgressTick } from "@packages/domain/article";
import {
	SHARE_BALLOON_SCRIPT,
	renderShareBalloon,
} from "../../shared/share-balloon/share-balloon.component";
import { VIEW_STYLES } from "./view.styles";
import {
	decomposeTimeLeft,
	formatCounter,
} from "./view-expiry";

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");
const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;
const READER_IFRAME_SCRIPT = `<script src="/client-dist/reader-iframe.client.js" defer></script>`;
const EXPIRY_COUNTER_SCRIPT = `<script src="/client-dist/expiry-counter.client.js" defer></script>`;

const CANONICAL_BASE_URL = "https://readplace.com";
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

interface ExpiryFields {
	state: "permanent" | "counting" | "expired";
	message: string;
	expiresAtIso?: string;
}

function buildExpiryFields(expiresAt: Date | null, now: Date): ExpiryFields {
	if (expiresAt === null) {
		return { state: "permanent", message: "Public access doesn't expire." };
	}
	const msLeft = expiresAt.getTime() - now.getTime();
	if (msLeft <= 0) {
		return {
			state: "expired",
			message: "Public access has expired.",
			expiresAtIso: expiresAt.toISOString(),
		};
	}
	return {
		state: "counting",
		message: `Public access will expire in ${formatCounter(decomposeTimeLeft(msLeft))}`,
		expiresAtIso: expiresAt.toISOString(),
	};
}

const VIEW_TEMPLATE = readFileSync(
	join(__dirname, "view.template.html"),
	"utf-8",
);

export interface ViewAction {
	name: string;
	href: string;
	variant: "primary" | "secondary";
	/** When true the rendered link carries `data-expiry-save-link`, which the expiry-counter client uses to keep the link's `utm_content=Xd_Yh_left` value in sync with the countdown. Only set on the "Save to my queue" action. */
	expirySaveLink?: boolean;
}

export interface ViewPageInput {
	articleUrl: string;
	metadata: ArticleMetadata;
	estimatedReadTime: Minutes;
	content?: string;
	crawl?: ArticleCrawl;
	readerPollUrl?: string;
	summary?: GeneratedSummary;
	summaryPollUrl?: string;
	progress?: ProgressTick;
	actions: ViewAction[];
	extensionInstallUrl?: string;
	/** ISO timestamp when public access to this view expires (3 days after the most recent crawl/re-save). `null` for permanent links — `utm_source=fagnerbrack.com` or `utm_content` carrying a 6-hex-char userId prefix from the share-balloon / `/queue/:id/read` redirect. */
	expiresAt: Date | null;
	/** First 6 chars of the visiting user's userId, when authenticated. Stamped into the share-balloon's outbound utm_content so the receiving public view recognises the link as a logged-in user's share. */
	sharerUserIdPrefix?: string;
	/** Clock used to compute the initial SSR counter text. The route passes its injected `now` provider so the SSR state stays consistent with the savedAt the same handler just wrote. Defaults to `new Date()` for callers (tests) that don't need clock control. */
	now?: Date;
}

export function ViewPage(input: ViewPageInput): PageBody {
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

	const canonicalViewUrl = `${CANONICAL_BASE_URL}/view/${encodeURIComponent(input.articleUrl)}`;

	const shareBalloon = renderShareBalloon({
		shareUrl: canonicalViewUrl,
		shareTitle: input.metadata.title,
		shareHint: "Click here to share this view!",
		shareSource: "reader-public",
		sharerUserIdPrefix: input.sharerUserIdPrefix,
	});

	const expiry = buildExpiryFields(input.expiresAt, input.now ?? new Date());

	const content = render(VIEW_TEMPLATE, {
		innerContent,
		articleUrl: input.articleUrl,
		actions: input.actions,
		shareBalloon,
		expiryState: expiry.state,
		expiryMessage: expiry.message,
		expiresAtIso: expiry.expiresAtIso,
	});

	const ogImage = input.metadata.imageUrl ?? DEFAULT_OG_IMAGE;
	const twitterImage = input.metadata.imageUrl ?? DEFAULT_TWITTER_IMAGE;
	const ogImageAlt = input.metadata.imageUrl
		? input.metadata.title
		: DEFAULT_OG_ALT;
	const description = truncateForSeo(
		pickExcerpt(input.summary, input.metadata.excerpt) || "View on Readplace.",
	);

	const structuredData: Record<string, unknown> = {
		"@context": "https://schema.org",
		"@type": "Article",
		headline: input.metadata.title,
		description: description,
		url: canonicalViewUrl,
		isBasedOn: { "@type": "Article", url: input.articleUrl },
	};
	if (input.metadata.imageUrl) {
		structuredData.image = input.metadata.imageUrl;
	}

	return {
		seo: {
			title: formatViewDocumentTitle(input.metadata.title),
			description,
			canonicalUrl: `/view/${encodeURIComponent(input.articleUrl)}`,
			ogType: "article",
			ogImage,
			ogImageAlt,
			twitterImage,
			robots: "index, follow",
			structuredData: [structuredData],
		},
		styles: VIEW_STYLES,
		bodyClass: "page-view",
		content: { html: content },
		scripts: SHARE_BALLOON_SCRIPT + PROGRESS_BAR_SCRIPT + READER_IFRAME_SCRIPT + EXPIRY_COUNTER_SCRIPT,
	};
}
