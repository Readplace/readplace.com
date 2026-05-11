import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import type { Minutes } from "@packages/domain/article";
import { render } from "../../../render";

const TEMPLATE = readFileSync(join(__dirname, "article-header.template.html"), "utf-8");

export interface ArticleHeaderInput {
	title: string;
	siteName: string;
	estimatedReadTime: Minutes;
	url: string;
	backLink?: { href: string; label: string };
}

function renderTemplate(input: ArticleHeaderInput, oob: boolean): string {
	return render(TEMPLATE, {
		title: input.title,
		siteName: input.siteName,
		estimatedReadTime: input.estimatedReadTime,
		url: input.url,
		backLink: input.backLink,
		oob,
	});
}

/**
 * Inline render: ships with the initial page response. The `id="article-header"`
 * is the swap target that poll responses replace via hx-swap-oob, so the same
 * element drives both the SSR view and every later metadata refresh.
 */
export function renderArticleHeader(input: ArticleHeaderInput): string {
	return renderTemplate(input, false);
}

/**
 * OOB render: piggybacks on the existing reader/summary poll responses so the
 * title, site name and read time settle in place once the crawl finishes,
 * instead of leaving the hostname stub on screen until manual refresh.
 */
export function renderArticleHeaderOob(input: ArticleHeaderInput): string {
	return renderTemplate(input, true);
}

/**
 * `<title>` OOB fragment. htmx matches by id, so the live <title> in the page
 * <head> carries `id="document-title"` and we emit a same-id replacement here.
 * Format is owned by the caller (e.g. "Foo — Readplace Reader" vs "Foo | Reader
 * View") so each reader keeps its existing tab title shape.
 */
export function renderDocumentTitleOob(documentTitle: string): string {
	return `<title id="document-title" hx-swap-oob="outerHTML">${Handlebars.Utils.escapeExpression(documentTitle)}</title>`;
}
