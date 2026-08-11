import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { DeviceClass } from "@packages/web-analytics";
import type {
	ArticleAction,
	QueueArticleViewModel,
} from "../queue.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "queue-card.template.html"), "utf-8");

export interface ActionDisplayModel extends ArticleAction {
	buttonClass: string;
	formClass: string;
	disabled: boolean;
	affordance: "with-loader" | "bare";
	/** Stable id on the status button so the shared toast focus script
	 * (toast.client.ts) can restore keyboard focus after a card-scoped status
	 * swap removes it: finding the recorded id gone, it lands focus on the
	 * confirmation toast. Absent on the delete fallback, which keeps a full-swap. */
	buttonId?: string;
}

export interface QueueCardDisplayModel extends QueueArticleViewModel {
	titleLinkUrl: string;
	excerptLinkUrl: string;
	thumbnailLinkUrl: string;
	unreadClass: string;
	excerptClampClass: string;
	isFirst: boolean;
	cardStatus: "pending" | "terminal";
	isProcessing: boolean;
	processingHiddenClass: string;
	urlEmptyClass: string;
	actions: ActionDisplayModel[];
}

export function toActionDisplayModel(
	action: ArticleAction,
	options: { isProcessing: boolean; articleId: string },
): ActionDisplayModel {
	const isStatusAction = action.testAction !== "delete";
	const buttonClass = isStatusAction
		? "queue-article__action-btn queue-article__action-btn--status"
		: "queue-article__action-btn queue-article__action-btn--delete";
	return {
		...action,
		url: withInternalTracking(action.url, { source: "queue-card", content: action.testAction }),
		// A submit button cannot open a popover — button activation behaviour
		// submits and returns before the popover step — so the confirmed delete
		// ships as a separate trigger and this form stays as the fallback for
		// browsers without popover support. It answers to its own test action so
		// the two controls can never collide in a locator.
		testAction: isStatusAction ? action.testAction : "delete-fallback",
		buttonClass,
		formClass: isStatusAction
			? "queue-article__action-form"
			: "queue-article__action-form queue-article__delete-fallback",
		disabled: options.isProcessing && isStatusAction,
		affordance: isStatusAction ? "with-loader" : "bare",
		buttonId: isStatusAction ? `queue-status-${options.articleId}` : undefined,
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
		excerptClampClass:
			article.excerptSource === "parsed" ? " queue-article__excerpt--clamped" : "",
		isFirst: options.isFirst,
		cardStatus: isProcessing ? "pending" : "terminal",
		isProcessing,
		processingHiddenClass: isProcessing ? "" : " queue-article__processing--hidden",
		urlEmptyClass: article.siteName ? "" : " queue-article__url--empty",
		actions: article.actions.map((action) =>
			toActionDisplayModel(action, { isProcessing, articleId: article.id }),
		),
	};
}

/** Lets the template branch on the `affordance` string enum
 * (`{{#if (eq affordance "with-loader")}}`); Handlebars has no built-in equality. */
const eq = (a: unknown, b: unknown): boolean => a === b;

export function renderQueueCard(displayModel: QueueCardDisplayModel): string {
	return render(TEMPLATE, displayModel, { helpers: { eq } });
}
