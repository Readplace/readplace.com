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
}

export interface QueueCardDisplayModel extends QueueArticleViewModel {
	linkUrl: string;
	unreadClass: string;
	isFirst: boolean;
	cardStatus: "pending" | "terminal";
	actions: ActionDisplayModel[];
}

export function toActionDisplayModel(action: ArticleAction): ActionDisplayModel {
	return {
		...action,
		buttonClass:
			action.testAction === "delete"
				? "queue-article__action-btn queue-article__action-btn--delete"
				: "queue-article__action-btn",
	};
}

export function toQueueCardDisplayModel(
	article: QueueArticleViewModel,
	options: { isFirst: boolean },
): QueueCardDisplayModel {
	return {
		...article,
		linkUrl: `/queue/${article.id}/view`,
		unreadClass: article.isUnread ? " queue-article--unread" : "",
		isFirst: options.isFirst,
		cardStatus: article.cardPollUrl ? "pending" : "terminal",
		actions: article.actions.map(toActionDisplayModel),
	};
}

export function renderQueueCard(displayModel: QueueCardDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
