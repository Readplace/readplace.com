import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { DeviceClass } from "../../../middleware/analytics";
import type {
	ArticleAction,
	QueueArticleViewModel,
} from "../queue.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "queue-card.template.html"), "utf-8");

export interface ActionDisplayModel extends ArticleAction {
	buttonClass: string;
	disabled: boolean;
}

export interface QueueCardDisplayModel extends QueueArticleViewModel {
	titleLinkUrl: string;
	excerptLinkUrl: string;
	thumbnailLinkUrl: string;
	unreadClass: string;
	isFirst: boolean;
	cardStatus: "pending" | "terminal";
	isProcessing: boolean;
	processingHiddenClass: string;
	urlEmptyClass: string;
	actions: ActionDisplayModel[];
}

export function toActionDisplayModel(
	action: ArticleAction,
	options: { isProcessing: boolean },
): ActionDisplayModel {
	const isStatusAction = action.testAction !== "delete";
	const buttonClass = isStatusAction
		? "queue-article__action-btn queue-article__action-btn--status"
		: "queue-article__action-btn queue-article__action-btn--delete";
	return {
		...action,
		url: withInternalTracking(action.url, { source: "queue-card", content: action.testAction }),
		buttonClass,
		disabled: options.isProcessing && isStatusAction,
	};
}

export function toQueueCardDisplayModel(
	article: QueueArticleViewModel,
	options: { isFirst: boolean; deviceClass: DeviceClass },
): QueueCardDisplayModel {
	const isProcessing = Boolean(article.cardPollUrl);
	const readerHref = `/queue/${article.id}/view`;
	const openReaderLink = (content: string) =>
		withInternalTracking(readerHref, { source: "queue-card", content, term: options.deviceClass });
	return {
		...article,
		titleLinkUrl: openReaderLink("open-article-title"),
		excerptLinkUrl: openReaderLink("open-article-excerpt"),
		thumbnailLinkUrl: openReaderLink("open-article-thumbnail"),
		unreadClass: article.isUnread ? " queue-article--unread" : " queue-article--read",
		isFirst: options.isFirst,
		cardStatus: isProcessing ? "pending" : "terminal",
		isProcessing,
		processingHiddenClass: isProcessing ? "" : " queue-article__processing--hidden",
		urlEmptyClass: article.siteName ? "" : " queue-article__url--empty",
		actions: article.actions.map((action) =>
			toActionDisplayModel(action, { isProcessing }),
		),
	};
}

export function renderQueueCard(displayModel: QueueCardDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
