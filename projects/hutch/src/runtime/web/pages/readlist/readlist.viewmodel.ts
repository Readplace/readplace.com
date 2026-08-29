import {
	displayableReadTime,
	type DisplayableReadTime,
	type SavedArticle,
	type SaveableUrlErrorCode,
} from "@packages/domain/article";
import type { IconName } from "@packages/ui-icons";
import { type LocalTime, toAbsoluteDate, toRelativeOrDate } from "@packages/web-shell";
import type { FindArticlesResult } from "@packages/provider-contracts/article-store";
import {
	type PickedExcerpt,
	pickExcerpt,
} from "../../../providers/article-summary/article-summary.helpers";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { ComponentError } from "../../shared/component-error.types";
import { MAX_POLLS } from "@packages/web-shell";
import { buildCardPollUrl } from "./readlist-card/readlist-card-poll-url";
import {
	deleteConfirmPopoverId,
	type DeleteConfirmViewModel,
} from "./readlist-card/delete-confirm.component";
import {
	markStatusConfirmPopoverId,
	type MarkStatusConfirmViewModel,
} from "./mark-status-confirm.component";
import { isCardTerminal } from "./readlist-card/is-card-terminal";
import type { LinkParams, ReadlistUrlState } from "./readlist.url";
import { buildReadlistCountsUrl, buildReadlistUrl, readlistReturnQuery } from "./readlist.url";
import type { StatusFlash } from "./readlist.error";
import type { EffectiveAccess } from "@packages/subscription-access";

export type SubscriptionBannerState =
	| { state: "none" }
	| { state: "trial-countdown"; daysLeft: number; daysLeftWord: "day" | "days" }
	| { state: "cancellation-scheduled"; cancellationEffectiveAt: LocalTime }
	| { state: "inactive" };

export interface ArticleActionField {
	name: string;
	value: string;
}

export interface ArticleAction {
	method: string;
	url: string;
	text: string;
	/** Names an icon from the shared set; `text` then becomes the button's
	 * screen-reader name instead of its visible label. */
	iconName?: IconName;
	title: string;
	testAction: string;
	fields: ArticleActionField[];
	confirmPopoverId?: string;
}

export interface ReadlistArticleViewModel {
	id: string;
	title: string;
	siteName: string;
	excerpt: string;
	excerptSource: PickedExcerpt["source"];
	url: string;
	status: string;
	isUnread: boolean;
	readTime: DisplayableReadTime | undefined;
	saved: LocalTime;
	imageUrl?: string;
	actions: ArticleAction[];
	deleteConfirm?: DeleteConfirmViewModel;
	markStatusConfirm?: MarkStatusConfirmViewModel;
	/**
	 * Set when the row's crawl/summary state machines are still in flight.
	 * The card renders an htmx poll against this URL every 3s; once both
	 * pipelines reach a terminal state the field is undefined and the card
	 * stops ticking. See isCardTerminal for the rules.
	 */
	cardPollUrl?: string;
	readerHref: string;
	/**
	 * True when the card stopped polling because the poll cap was reached
	 * (not because the pipelines hit a terminal state). The card is sitting
	 * on a hostname stub indefinitely; the user gets an inline hint pointing
	 * them at the source URL so they're not stuck staring at a half-loaded
	 * card waiting for something that may never land.
	 */
	isStalePending: boolean;
}

export interface ImportSkippedViewModel {
	readonly entries: ReadonlyArray<{ readonly url: string; readonly reasonLabel: string }>;
	readonly andMore: number;
}

export interface ReadlistViewModel {
	articles: ReadlistArticleViewModel[];
	filters: ReadlistUrlState;
	isEmpty: boolean;
	currentPage: number;
	countsUrl: string;
	paginationUrls: {
		prev?: string;
		next?: string;
	};
	errors?: ComponentError[];
	saveErrorCode?: SaveableUrlErrorCode;
	importFlash?: string;
	importSkipped?: ImportSkippedViewModel;
	statusFlash?: {
		message: string;
		undoUrl: string;
		undoStatus: "read" | "unread";
	};
	subscriptionBanner: SubscriptionBannerState;
	accessIsReadOnly: boolean;
}

function formatTrialDaysLeft(trialEndsAt: string, now: Date): { daysLeft: number; daysLeftWord: "day" | "days" } {
	const remaining = new Date(trialEndsAt).getTime() - now.getTime();
	const daysLeft = Math.max(1, Math.ceil(remaining / 86_400_000));
	return { daysLeft, daysLeftWord: daysLeft === 1 ? "day" : "days" };
}

function toSubscriptionBannerState(access: EffectiveAccess, now: Date): SubscriptionBannerState {
	switch (access.banner) {
		case "none":
			return { state: "none" };
		case "trial-countdown": {
			const { daysLeft, daysLeftWord } = formatTrialDaysLeft(access.trialEndsAt, now);
			return { state: "trial-countdown", daysLeft, daysLeftWord };
		}
		case "cancellation-scheduled":
			return {
				state: "cancellation-scheduled",
				cancellationEffectiveAt: toAbsoluteDate({ iso: access.cancellationEffectiveAt }),
			};
		case "inactive":
			return { state: "inactive" };
	}
}

function toStatusActions(
	article: { id: string; status: string },
	returnQuery: string,
	confirmPopoverId: string | undefined,
): ArticleAction[] {
	const actions: ArticleAction[] = [];
	const confirm = confirmPopoverId === undefined ? {} : { confirmPopoverId };

	/** `swap=card` marks a status URL as the card affordance so the shared
	 * status route answers an htmx submit with the card-scoped fragment, while
	 * the Undo, reader and Siren callers (which build their own hrefs without it)
	 * keep the full-listing 303. It is a representation hint the server never
	 * trusts as state; delete keeps its full-<main> confirm flow, so only the
	 * status URLs carry it. */
	const cardQuery = `${returnQuery}${returnQuery ? "&" : "?"}swap=card`;

	if (article.status !== "read") {
		actions.push({
			method: "POST",
			url: `/queue/${article.id}/status${cardQuery}`,
			text: "Mark as read",
			title: "Mark as read",
			testAction: "mark-read",
			fields: [{ name: "status", value: "read" }],
			...confirm,
		});
	}

	if (article.status !== "unread") {
		actions.push({
			method: "POST",
			url: `/queue/${article.id}/status${cardQuery}`,
			text: "Mark as unread",
			title: "Mark as unread",
			testAction: "mark-unread",
			fields: [{ name: "status", value: "unread" }],
			...confirm,
		});
	}

	return actions;
}

function toDeleteAction(params: {
	articleId: string;
	returnQuery: string;
	confirmPopoverId: string | undefined;
}): ArticleAction {
	return {
		method: "POST",
		url: `/queue/${params.articleId}/delete${params.returnQuery}`,
		text: "Delete",
		iconName: "x",
		title: "Delete",
		testAction: "delete",
		fields: [],
		...(params.confirmPopoverId === undefined
			? {}
			: { confirmPopoverId: params.confirmPopoverId }),
	};
}

export function toReadlistArticleViewModel(params: {
	article: SavedArticle;
	now: Date;
	returnQuery: string;
	summary: GeneratedSummary | undefined;
	crawl: ArticleCrawl | undefined;
	filters: ReadlistUrlState;
	pollCount?: number;
	maxPolls: number;
	linkParams?: LinkParams;
	confirmReadlistLabels?: readonly string[];
	/** Absent means the reader has not chosen to skip the delete confirmation —
	 * including on render paths that never read the signal, so an unknown answer
	 * still asks before deleting. */
	deleteAcknowledged?: boolean;
}): ReadlistArticleViewModel {
	const { article, now, returnQuery, summary, crawl, filters, maxPolls } = params;
	const pollCount = params.pollCount ?? 1;
	const id = article.id.value;
	const reachedTerminal = isCardTerminal(crawl, summary);
	const cardPollUrl =
		reachedTerminal || pollCount > maxPolls
			? undefined
			: buildCardPollUrl({ articleId: id, pollCount, filters, extraParams: params.linkParams });
	const isStalePending = !reachedTerminal && pollCount > maxPolls;
	const deleteConfirmId = params.deleteAcknowledged ? undefined : deleteConfirmPopoverId(id);
	const deleteAction = toDeleteAction({
		articleId: id,
		returnQuery,
		confirmPopoverId: deleteConfirmId,
	});
	const excerpt = pickExcerpt(summary, article.metadata.excerpt);
	const markStatusConfirm =
		params.confirmReadlistLabels === undefined
			? undefined
			: {
					articleId: id,
					popoverId: markStatusConfirmPopoverId(id),
					url: `/queue/${id}/status${returnQuery}`,
					status: article.status === "read" ? ("unread" as const) : ("read" as const),
					queueLabels: params.confirmReadlistLabels,
				};
	return {
		id,
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		excerpt: excerpt.text,
		excerptSource: excerpt.source,
		// The card's source link shows the redirect destination once merged; the
		// title/excerpt still open the reader by `id`, so identity is untouched.
		url: article.displayUrl ?? article.url,
		status: article.status,
		isUnread: article.status === "unread",
		readTime: displayableReadTime(article),
		saved: toRelativeOrDate({ iso: article.savedAt.toISOString(), now }),
		imageUrl: article.metadata.imageUrl,
		actions: [
			...toStatusActions({ id, status: article.status }, returnQuery, markStatusConfirm?.popoverId),
			deleteAction,
		],
		...(deleteConfirmId === undefined
			? {}
			: { deleteConfirm: { articleId: id, popoverId: deleteConfirmId, url: deleteAction.url } }),
		markStatusConfirm,
		cardPollUrl,
		readerHref: `/queue/${id}/view${readlistReturnQuery({ readlist: filters.readlist }, params.linkParams)}`,
		isStalePending,
	};
}

export function toReadlistViewModel(
	result: FindArticlesResult,
	filters: ReadlistUrlState,
	options?: {
		now?: Date;
		errors?: ComponentError[];
		saveErrorCode?: SaveableUrlErrorCode;
		importFlash?: string;
		importSkipped?: ImportSkippedViewModel;
		statusFlash?: StatusFlash;
		summaryByUrl?: ReadonlyMap<string, GeneratedSummary | undefined>;
		crawlByUrl?: ReadonlyMap<string, ArticleCrawl | undefined>;
		effectiveAccess?: EffectiveAccess;
		linkParams?: LinkParams;
		confirmReadlistLabelsByUrl?: ReadonlyMap<string, readonly string[]>;
		deleteAcknowledged?: boolean;
	},
): ReadlistViewModel {
	const now = options?.now ?? new Date();
	const linkParams = options?.linkParams;
	const returnQuery = readlistReturnQuery(filters, linkParams);

	/** When effectiveAccess is omitted the caller is a server-side render path
	 * that has no authenticated user (Siren API, public reader permalink, etc.)
	 * — those code paths never reach the banner-rendering template, so we treat
	 * "no info" as founding/full-access for view-model purposes. The
	 * authenticated GET /queue handler always passes effectiveAccess. */
	const access: EffectiveAccess = options?.effectiveAccess ?? {
		tier: "founding",
		access: "full",
		banner: "none",
	};

	return {
		articles: result.articles.map((a) =>
			toReadlistArticleViewModel({
				article: a,
				now,
				returnQuery,
				summary: options?.summaryByUrl?.get(a.url),
				crawl: options?.crawlByUrl?.get(a.url),
				filters,
				maxPolls: MAX_POLLS,
				linkParams,
				confirmReadlistLabels: options?.confirmReadlistLabelsByUrl?.get(a.url),
				deleteAcknowledged: options?.deleteAcknowledged,
			}),
		),
		filters,
		isEmpty: result.articles.length === 0,
		currentPage: result.page,
		countsUrl: buildReadlistCountsUrl(filters, linkParams),
		paginationUrls: {
			prev:
				result.page > 1
					? buildReadlistUrl({ ...filters, page: result.page - 1 }, linkParams)
					: undefined,
			next: result.hasMore
				? buildReadlistUrl({ ...filters, page: result.page + 1 }, linkParams)
				: undefined,
		},
		errors: options?.errors,
		saveErrorCode: options?.saveErrorCode,
		importFlash: options?.importFlash,
		importSkipped: options?.importSkipped,
		statusFlash: options?.statusFlash
			? {
				message: options.statusFlash.message,
				undoUrl: `/queue/${options.statusFlash.undoArticleId}/status${returnQuery}`,
				undoStatus: options.statusFlash.undoStatus,
			}
			: undefined,
		subscriptionBanner: toSubscriptionBannerState(access, now),
		accessIsReadOnly: access.access === "read-only",
	};
}
