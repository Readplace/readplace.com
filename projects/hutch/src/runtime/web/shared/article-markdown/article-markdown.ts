import matter from "gray-matter";
import {
	type SavedArticle,
	displayableReadTime,
	hostStubMetadata,
	isNonArticleHost,
} from "@packages/domain/article";
import type { ReadlistRef, ReadlistSlug } from "@packages/domain/readlist";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { htmlToMarkdown } from "@packages/web-shell";
import { pickExcerpt } from "../../../providers/article-summary/article-summary.helpers";
import { buildQueryString } from "../../api/collection-query";

const FRONTMATTER_OPTIONS = { language: "yaml", lineWidth: -1 };
const SUMMARY_CALLOUT_OPENER = "> [!summary] Summary (TL;DR)";

type ContentStatus = "ready" | "processing" | "failed" | "not-an-article";

interface ArticleMarkdownInput {
	article: SavedArticle;
	readlist: ReadlistSlug;
	readlists: readonly ReadlistRef[];
	appOrigin: string;
	crawl: ArticleCrawl | undefined;
	content: string | undefined;
	summary: GeneratedSummary | undefined;
}

interface DocumentParts {
	contentStatus: ContentStatus;
	metadata: { title: string; siteName: string; excerpt: string; wordCount: number };
	summary: GeneratedSummary | undefined;
	body: string;
}

function documentParts(input: ArticleMarkdownInput): DocumentParts {
	const { article, crawl, content, summary } = input;
	if (isNonArticleHost(article.url)) {
		return {
			contentStatus: "not-an-article",
			metadata: { ...hostStubMetadata(article.destinationUrl), wordCount: 0 },
			summary: undefined,
			body: "",
		};
	}
	const { metadata } = article;
	if (crawl?.status === "failed" || crawl?.status === "unsupported") {
		return { contentStatus: "failed", metadata, summary, body: "" };
	}
	if (crawl?.status === "pending" || content === undefined) {
		return { contentStatus: "processing", metadata, summary, body: "" };
	}
	return { contentStatus: "ready", metadata, summary, body: htmlToMarkdown(content) };
}

function summaryCallout(summary: string): string {
	const quotedLines = summary.split("\n").map((line) => (line === "" ? ">" : `> ${line}`));
	return [SUMMARY_CALLOUT_OPENER, ...quotedLines].join("\n");
}

export function articleMarkdown(input: ArticleMarkdownInput): string {
	const { article, readlist, readlists, appOrigin } = input;
	const parts = documentParts(input);
	const { metadata, summary } = parts;
	const readTime = displayableReadTime({
		metadata,
		estimatedReadTime: article.estimatedReadTime,
	});
	const description = pickExcerpt(summary, metadata.excerpt).text;
	const summaryTracked = parts.contentStatus === "ready" || parts.contentStatus === "processing";
	const summaryStatus = summary === undefined ? "pending" : summary.status;
	const readySummary =
		summaryTracked && summary?.status === "ready" ? summary.summary : undefined;

	const data = {
		title: metadata.title,
		source: article.destinationUrl,
		site: metadata.siteName,
		...(description === "" ? {} : { description }),
		created: article.savedAt.toISOString(),
		...(metadata.wordCount > 0 ? { words: metadata.wordCount } : {}),
		readplace_id: article.id.value,
		readplace_url: `${appOrigin}/queue/${article.id.value}/view${buildQueryString({ readlist })}`,
		readplace_status: article.status,
		...(article.readAt === undefined ? {} : { readplace_read_at: article.readAt.toISOString() }),
		...(readTime === undefined ? {} : { readplace_read_time: article.estimatedReadTime }),
		readplace_readlists: readlists.map((entry) => entry.label),
		readplace_content_status: parts.contentStatus,
		...(summaryTracked ? { readplace_summary_status: summaryStatus } : {}),
		...(readySummary === undefined ? {} : { readplace_summary: readySummary }),
	};

	const frontmatter = matter.stringify("", data, FRONTMATTER_OPTIONS).trimEnd();
	const callout = readySummary === undefined ? "" : summaryCallout(readySummary);
	return `${[frontmatter, callout, parts.body].filter((part) => part !== "").join("\n\n")}\n`;
}
