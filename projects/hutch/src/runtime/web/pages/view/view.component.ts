import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_HIDE_SCRIPT, readerScripts } from "../../shared/reader-nav-script";
import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { decomposeTimeLeft, formatCounter } from "@packages/time-left";
import { pickExcerpt, truncateForSeo } from "../../../providers/article-summary/article-summary.helpers";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { requireEnv } from "@packages/require-env";
import { render, withInternalTracking } from "@packages/web-shell";
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
import type { SharedUserId } from "./view-expiry";
import { viewPathFor } from "./view-path";
import { VIEW_STYLES } from "./view.styles";

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");
const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;
const EXPIRY_COUNTER_SCRIPT = `<script src="/client-dist/expiry-counter.client.js" defer></script>`;
const VIEW_PAYWALL_SCRIPT = `<script src="/client-dist/view-paywall.client.js" defer></script>`;

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

const VIEW_PAYWALL_TEMPLATE = readFileSync(
	join(__dirname, "view-paywall.template.html"),
	"utf-8",
);

const PAYWALL_TRACKING_SOURCE = "view-paywall";
const PAYWALL_REFERRAL_SOURCE = "readplace";
const PAYWALL_REFERRAL_MEDIUM = "referral";

function paywallOriginalHref(originalUrl: URL): string {
	const tagged = new URL(originalUrl);
	tagged.searchParams.set("utm_source", PAYWALL_REFERRAL_SOURCE);
	tagged.searchParams.set("utm_medium", PAYWALL_REFERRAL_MEDIUM);
	tagged.searchParams.set("utm_content", "read-original");
	return tagged.toString();
}

function renderViewPaywall(input: {
	saveHref: string;
	originalUrl: string;
	expiresAtIso: string;
	sharerInactive: boolean;
}): string {
	const originalUrl = new URL(input.originalUrl);
	return render(VIEW_PAYWALL_TEMPLATE, {
		saveHref: withInternalTracking(input.saveHref, {
			source: PAYWALL_TRACKING_SOURCE,
			content: "save-to-queue",
		}),
		originalUrl: paywallOriginalHref(originalUrl),
		originalHostname: originalUrl.hostname,
		expiresAtIso: input.expiresAtIso,
		sharerInactive: input.sharerInactive,
	});
}

export interface ViewAction {
	name: string;
	href: string;
	variant: "primary" | "secondary";
	expirySaveLink?: boolean;
}

export type ExpiryState = "permanent" | "counting" | "expired";

export interface ExpiryFields {
	state: ExpiryState;
	message: string;
	expiresAtIso?: string;
}

/** Public /view pages can be permanent (founder syndication or authenticated
 * sharer), counting down to expiry, or already expired. The counter text uses
 * day/hour/minute/second resolution so the urgency feels live without leaking
 * sub-second jitter into the SSR markup. */
export function buildExpiryFields(
	expiresAt: Date | null,
	now: Date,
): ExpiryFields {
	if (expiresAt === null) return { state: "permanent", message: "" };
	const msLeft = expiresAt.getTime() - now.getTime();
	const expiresAtIso = expiresAt.toISOString();
	if (msLeft <= 0) return { state: "expired", message: "Public access has expired.", expiresAtIso };
	return {
		state: "counting",
		message: `Public access will expire in ${formatCounter(decomposeTimeLeft(msLeft))}`,
		expiresAtIso,
	};
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
	extensionInstallUrl?: string;
	expiresAt: Date | null;
	now: Date;
	sharerInactive: boolean;
	sharerUserIdPrefix?: SharedUserId;
	crawlVersions?: LocalTime[];
}

export function ViewPage(input: ViewPageInput): PageBody {
	const actions = RegularReader({ actionBtns: {} });
	const innerContent = renderArticleBody({
		title: input.metadata.title,
		siteName: input.metadata.siteName,
		estimatedReadTime: input.estimatedReadTime,
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
	});

	const viewPath = viewPathFor(input.articleUrl);
	const shareableViewUrl = `${input.appOrigin}${viewPath}`;

	const shareBalloon = renderShareBalloon({
		shareUrl: shareableViewUrl,
		shareTitle: input.metadata.title,
		shareHint: "Click here to share this view!",
		shareSource: "reader-public",
		sharerUserIdPrefix: input.sharerUserIdPrefix,
	});

	const expiry = buildExpiryFields(input.expiresAt, input.now);

	const primarySaveAction = input.actions.find(
		(action) => action.variant === "primary",
	);
	assert(primarySaveAction, "view must render a primary Save action");

	/* The paywall only exists for a non-permanent, fully-rendered reader: a
	 * permanent page (prod, authenticated, founder syndication, valid sharer)
	 * emits nothing new, and a pending/failed crawl already shows its own
	 * "Your link is saved" reframe that must not be blurred. */
	let paywall = "";
	if (expiry.state !== "permanent" && input.crawl?.status === "ready") {
		assert(expiry.expiresAtIso, "a non-permanent expiry must carry an ISO deadline");
		paywall = renderViewPaywall({
			saveHref: primarySaveAction.href,
			originalUrl: input.displayUrl ?? input.articleUrl,
			expiresAtIso: expiry.expiresAtIso,
			sharerInactive: input.sharerInactive,
		});
	}

	const content = render(VIEW_TEMPLATE, {
		innerContent,
		articleUrl: input.articleUrl,
		actions: input.actions,
		shareBalloon,
		paywall,
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
			structuredData: [structuredData],
		},
		styles: VIEW_STYLES,
		bodyClass: "page-view",
		content: { html: content },
		scripts: readerScripts({
			navHide: NAV_HIDE_SCRIPT,
			page:
				SHARE_BALLOON_SCRIPT +
				PROGRESS_BAR_SCRIPT +
				EXPIRY_COUNTER_SCRIPT +
				VIEW_PAYWALL_SCRIPT +
				CRAWL_BOOKMARK_SCRIPT,
		}),
	};
}
