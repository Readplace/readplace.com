import type { SavedArticle, SaveableUrlErrorCode } from "@packages/domain/article";
import type { FindArticlesResult } from "@packages/test-fixtures/providers/article-store";
import { pickExcerpt } from "../../../providers/article-summary/article-summary.helpers";
import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import type { ComponentError } from "../../shared/component-error.types";
import { MAX_POLLS } from "../../shared/article-reader/article-reader";
import { buildCardPollUrl } from "./queue-card/queue-card-poll-url";
import { isCardTerminal } from "./queue-card/is-card-terminal";
import type { QueueUrlState } from "./queue.url";
import { buildQueueUrl } from "./queue.url";

export interface ArticleActionField {
	name: string;
	value: string;
}

export interface ArticleAction {
	method: string;
	url: string;
	text: string;
	title: string;
	testAction: string;
	fields: ArticleActionField[];
}

export interface QueueArticleViewModel {
	id: string;
	title: string;
	siteName: string;
	excerpt: string;
	url: string;
	readTimeLabel: string;
	status: string;
	isUnread: boolean;
	savedAgo: string;
	imageUrl?: string;
	hasContent: boolean;
	actions: ArticleAction[];
	/**
	 * Set when the row's crawl/summary state machines are still in flight.
	 * The card renders an htmx poll against this URL every 3s; once both
	 * pipelines reach a terminal state the field is undefined and the card
	 * stops ticking. See isCardTerminal for the rules.
	 */
	cardPollUrl?: string;
}

export interface ImportSkippedViewModel {
	readonly entries: ReadonlyArray<{ readonly url: string; readonly reasonLabel: string }>;
	readonly andMore: number;
}

export interface QueueViewModel {
	articles: QueueArticleViewModel[];
	filters: QueueUrlState;
	isEmpty: boolean;
	totalPages: number;
	currentPage: number;
	total: number;
	unreadCount: number;
	filterUrls: {
		unread: string;
		read: string;
	};
	paginationUrls: {
		prev?: string;
		next?: string;
	};
	errors?: ComponentError[];
	saveErrorCode?: SaveableUrlErrorCode;
	importFlash?: string;
	importSkipped?: ImportSkippedViewModel;
}

function formatRelativeDate(date: Date, now: Date): string {
	const diffMs = now.getTime() - date.getTime();
	const diffMinutes = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMinutes < 1) return "just now";
	if (diffMinutes < 60) return `${diffMinutes}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 30) return `${diffDays}d ago`;
	return date.toLocaleDateString("en-AU", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

function toArticleActions(
	article: { id: string; status: string },
	returnQuery: string,
): ArticleAction[] {
	const actions: ArticleAction[] = [];

	if (article.status !== "read") {
		actions.push({
			method: "POST",
			url: `/queue/${article.id}/status${returnQuery}`,
			text: "Mark as read",
			title: "Mark as read",
			testAction: "mark-read",
			fields: [{ name: "status", value: "read" }],
		});
	}

	if (article.status !== "unread") {
		actions.push({
			method: "POST",
			url: `/queue/${article.id}/status${returnQuery}`,
			text: "Unread",
			title: "Mark as unread",
			testAction: "mark-unread",
			fields: [{ name: "status", value: "unread" }],
		});
	}

	actions.push({
		method: "POST",
		url: `/queue/${article.id}/delete${returnQuery}`,
		text: "×",
		title: "Delete",
		testAction: "delete",
		fields: [],
	});

	return actions;
}

export function toQueueArticleViewModel(params: {
	article: SavedArticle;
	now: Date;
	returnQuery: string;
	summary: GeneratedSummary | undefined;
	crawl: ArticleCrawl | undefined;
	filters: QueueUrlState;
	pollCount?: number;
	maxPolls: number;
}): QueueArticleViewModel {
	const { article, now, returnQuery, summary, crawl, filters, maxPolls } = params;
	const pollCount = params.pollCount ?? 1;
	const readTime = article.estimatedReadTime;
	const id = article.id.value;
	const cardPollUrl =
		isCardTerminal(crawl, summary) || pollCount > maxPolls
			? undefined
			: buildCardPollUrl({ articleId: id, pollCount, filters });
	return {
		id,
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		excerpt: pickExcerpt(summary, article.metadata.excerpt),
		url: article.url,
		readTimeLabel: `${readTime} min read`,
		status: article.status,
		isUnread: article.status === "unread",
		savedAgo: formatRelativeDate(article.savedAt, now),
		imageUrl: article.metadata.imageUrl,
		hasContent: Boolean(article.content),
		actions: toArticleActions({ id, status: article.status }, returnQuery),
		cardPollUrl,
	};
}

export function toQueueViewModel(
	result: FindArticlesResult,
	filters: QueueUrlState,
	options?: {
		now?: Date;
		errors?: ComponentError[];
		saveErrorCode?: SaveableUrlErrorCode;
		importFlash?: string;
		importSkipped?: ImportSkippedViewModel;
		unreadCount?: number;
		summaryByUrl?: ReadonlyMap<string, GeneratedSummary | undefined>;
		crawlByUrl?: ReadonlyMap<string, ArticleCrawl | undefined>;
	},
): QueueViewModel {
	const now = options?.now ?? new Date();
	const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
	const baseFilters = { order: filters.order };
	const queueUrl = buildQueueUrl(filters);
	const queryIndex = queueUrl.indexOf("?");
	const returnQuery = queryIndex !== -1 ? queueUrl.slice(queryIndex) : "";

	return {
		articles: result.articles.map((a) =>
			toQueueArticleViewModel({
				article: a,
				now,
				returnQuery,
				summary: options?.summaryByUrl?.get(a.url),
				crawl: options?.crawlByUrl?.get(a.url),
				filters,
				maxPolls: MAX_POLLS,
			}),
		),
		filters,
		isEmpty: result.total === 0,
		totalPages,
		currentPage: result.page,
		total: result.total,
		unreadCount: options?.unreadCount ?? result.total,
		filterUrls: {
			unread: buildQueueUrl({ ...baseFilters, tab: "queue" }),
			read: buildQueueUrl({ ...baseFilters, tab: "done" }),
		},
		paginationUrls: {
			prev:
				result.page > 1
					? buildQueueUrl({ ...filters, page: result.page - 1 })
					: undefined,
			next:
				result.page < totalPages
					? buildQueueUrl({ ...filters, page: result.page + 1 })
					: undefined,
		},
		errors: options?.errors,
		saveErrorCode: options?.saveErrorCode,
		importFlash: options?.importFlash,
		importSkipped: options?.importSkipped,
	};
}
