import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";
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
	linkUrl: string;
	unreadClass: string;
	isFirst: boolean;
	cardStatus: "pending" | "terminal";
	isProcessing: boolean;
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
		buttonClass,
		disabled: options.isProcessing && isStatusAction,
	};
}

export function toQueueCardDisplayModel(
	article: QueueArticleViewModel,
	options: { isFirst: boolean },
): QueueCardDisplayModel {
	const isProcessing = Boolean(article.cardPollUrl);
	return {
		...article,
		linkUrl: `/queue/${article.id}/view`,
		unreadClass: article.isUnread ? " queue-article--unread" : "",
		isFirst: options.isFirst,
		cardStatus: isProcessing ? "pending" : "terminal",
		isProcessing,
		actions: article.actions.map((action) =>
			toActionDisplayModel(action, { isProcessing }),
		),
	};
}

export function renderQueueCard(displayModel: QueueCardDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
