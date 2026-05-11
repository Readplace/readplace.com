import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Minutes } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { requireEnv } from "../../../require-env";
import { render } from "../../render";
import { renderArticleHeader } from "./article-header/article-header.component";
import { renderProgressBar } from "./progress-bar.component";
import type { ProgressTick } from "@packages/domain/article";
import { renderReaderSlot } from "./reader-slot/reader-slot.component";
import { renderSummarySlot } from "./summary-slot/summary-slot.component";

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");

const ARTICLE_BODY_TEMPLATE = readFileSync(
	join(__dirname, "article-body.template.html"),
	"utf-8",
);

export interface ArticleBodyInput {
	title: string;
	siteName: string;
	estimatedReadTime: Minutes;
	url: string;
	content?: string;
	crawl?: ArticleCrawl;
	readerPollUrl?: string;
	summary?: GeneratedSummary;
	summaryPollUrl?: string;
	summaryOpen?: boolean;
	audioEnabled?: boolean;
	backLink?: { topHref: string; bottomHref: string; label: string };
	extensionInstallUrl?: string;
	/**
	 * Single unified progress tick. When omitted (everything terminal, or
	 * crawl-failed) the bar still renders but in its hidden state so OOB
	 * progress-bar swaps from poll responses remain valid even when the
	 * initial SSR bar was hidden.
	 */
	progress?: ProgressTick;
}

export function renderArticleBody(input: ArticleBodyInput): string {
	const readerSlotHtml = renderReaderSlot({
		crawl: input.crawl,
		content: input.content,
		url: input.url,
		readerPollUrl: input.readerPollUrl,
		extensionInstallUrl: input.extensionInstallUrl,
	});

	const summarySlotHtml = renderSummarySlot({
		crawl: input.crawl,
		summary: input.summary,
		summaryPollUrl: input.summaryPollUrl,
		summaryOpen: input.summaryOpen,
	});

	const progressBarHtml = renderProgressBar({ progress: input.progress });

	const headerHtml = renderArticleHeader({
		title: input.title,
		siteName: input.siteName,
		estimatedReadTime: input.estimatedReadTime,
		url: input.url,
		backLink: input.backLink
			? { href: input.backLink.topHref, label: input.backLink.label }
			: undefined,
	});

	return render(ARTICLE_BODY_TEMPLATE, {
		headerHtml,
		readerSlotHtml,
		summarySlotHtml,
		progressBarHtml,
		audioEnabled: input.audioEnabled,
		staticBaseUrl: STATIC_BASE_URL,
		backLink: input.backLink,
	});
}
