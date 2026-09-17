import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderInFlightDots, withInternalTracking } from "@packages/web-shell";
import type { DeviceClass } from "@packages/web-analytics";

import type { ArticleAction, ReadlistArticleViewModel } from "../readlist.viewmodel";
import { withDesignFeature } from "./readlist-design-feature";

const TEMPLATE = readFileSync(join(__dirname, "readlist-design-card.template.html"), "utf-8");

interface DesignCardAction extends ArticleAction {
	fallbackClass: string;
	disabled: boolean;
	loaderHtml: string;
	buttonId?: string;
}

interface DesignCardTrigger {
	popoverId: string;
	title: string;
	text: string;
	testAction: string;
}

export interface ReadlistDesignCardDisplayModel extends ReadlistArticleViewModel {
	titleLinkUrl: string;
	excerptLinkUrl: string;
	statusClass: string;
	excerptClampClass: string;
	isFirst: boolean;
	cardStatus: "pending" | "terminal";
	processingHiddenClass: string;
	metaHiddenClass: string;
	urlEmptyClass: string;
	readTimeLabel: string;
	readTimeEmptyClass: string;
	statusActions: DesignCardAction[];
	statusTriggers: DesignCardTrigger[];
	menuActions: DesignCardAction[];
	menuTriggers: DesignCardTrigger[];
}

const STATUS_LOADER_HTML = renderInFlightDots("readlist-article__action-btn-loader in-flight-dots");

function isDeleteAction(action: ArticleAction): boolean {
	return action.testAction === "delete";
}

function toDesignAction(
	action: ArticleAction,
	options: { isProcessing: boolean; articleId: string },
): DesignCardAction {
	const isConfirmed = action.confirmPopoverId !== undefined;
	const isStatus = !isDeleteAction(action);
	return {
		...action,
		url: withInternalTracking(withDesignFeature(action.url), {
			source: "queue-card",
			content: action.testAction,
		}),
		testAction: isConfirmed ? `${action.testAction}-fallback` : action.testAction,
		fallbackClass: isConfirmed ? " readlist-design-card__fallback" : "",
		disabled: options.isProcessing && isStatus,
		loaderHtml: isStatus ? STATUS_LOADER_HTML : "",
		buttonId: isStatus ? `readlist-status-${options.articleId}` : undefined,
	};
}

function toTrigger(action: ArticleAction): DesignCardTrigger[] {
	if (action.confirmPopoverId === undefined) return [];
	return [
		{
			popoverId: action.confirmPopoverId,
			title: action.title,
			text: action.text,
			testAction: action.testAction,
		},
	];
}

export function toReadlistDesignCardDisplayModel(
	article: ReadlistArticleViewModel,
	options: { isFirst: boolean; deviceClass: DeviceClass },
): ReadlistDesignCardDisplayModel {
	const isProcessing = Boolean(article.cardPollUrl);
	const openReaderLink = (content: string) =>
		withInternalTracking(article.readerHref, {
			source: "queue-card",
			content,
			term: options.deviceClass,
		});
	const statusActions = article.actions.filter((action) => !isDeleteAction(action));
	const deleteActions = article.actions.filter(isDeleteAction);
	const toAction = (action: ArticleAction) => toDesignAction(action, { isProcessing, articleId: article.id });
	return {
		...article,
		cardPollUrl: article.cardPollUrl === undefined ? undefined : withDesignFeature(article.cardPollUrl),
		titleLinkUrl: openReaderLink("open-article-title"),
		excerptLinkUrl: openReaderLink("open-article-excerpt"),
		statusClass: article.isUnread ? " readlist-design-card--unread" : " readlist-design-card--read",
		excerptClampClass:
			article.excerptSource === "parsed" ? " readlist-design-card__excerpt--clamped" : "",
		isFirst: options.isFirst,
		cardStatus: isProcessing ? "pending" : "terminal",
		processingHiddenClass: isProcessing ? "" : " readlist-design-card__processing--hidden",
		metaHiddenClass: isProcessing ? " readlist-design-card__meta--hidden" : "",
		urlEmptyClass: article.siteName ? "" : " readlist-design-card__site--empty",
		readTimeLabel: article.readTime?.label ?? "",
		readTimeEmptyClass: article.readTime ? "" : " readlist-design-card__read-time--empty",
		statusActions: statusActions.map(toAction),
		statusTriggers: statusActions.flatMap(toTrigger),
		menuActions: deleteActions.map(toAction),
		menuTriggers: deleteActions.flatMap(toTrigger),
	};
}

export function renderReadlistDesignCard(displayModel: ReadlistDesignCardDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
