import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { pickExcerpt, truncateForSeo } from "../../../providers/article-summary/article-summary.helpers";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { requireEnv } from "../../../require-env";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { renderArticleBody } from "../../shared/article-body/article-body.component";
import type { ProgressTick } from "@packages/domain/article";
import {
	SHARE_BALLOON_SCRIPT,
	renderShareBalloon,
} from "../../shared/share-balloon/share-balloon.component";
import { VIEW_STYLES } from "./view.styles";

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");
const PROGRESS_BAR_SCRIPT = `<script src="/client-dist/progress-bar.client.js" defer></script>`;

const CANONICAL_BASE_URL = "https://readplace.com";
const DEFAULT_OG_IMAGE = `${STATIC_BASE_URL}/og-image-1200x630.png`;
const DEFAULT_TWITTER_IMAGE = `${STATIC_BASE_URL}/twitter-card-1200x600.png`;
const DEFAULT_OG_ALT = "Readplace — A read-it-later app";

const VIEW_TEMPLATE = readFileSync(
	join(__dirname, "view.template.html"),
	"utf-8",
);

export interface ViewAction {
	name: string;
	href: string;
	variant: "primary" | "secondary";
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
	});

	const content = render(VIEW_TEMPLATE, {
		innerContent,
		articleUrl: input.articleUrl,
		actions: input.actions,
		shareBalloon,
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
			title: `${input.metadata.title} | Reader View`,
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
		scripts: SHARE_BALLOON_SCRIPT + PROGRESS_BAR_SCRIPT,
	};
}
