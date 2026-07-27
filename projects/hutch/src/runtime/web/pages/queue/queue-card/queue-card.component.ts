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
	/** "with-loader" for the mark-read/unread toggle — it renders the in-flight
	 * loader affordance and hx-disabled-elt so the button behaves like the
	 * reader's mark-read control during the htmx <main> swap. "bare" for the
	 * delete action, a static icon that opts out of the loader treatment. */
	affordance: "with-loader" | "bare";
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

/** Lets the template branch on the `affordance` string enum
 * (`{{#if (eq affordance "with-loader")}}`); Handlebars has no built-in equality. */
const eq = (a: unknown, b: unknown): boolean => a === b;

export function renderQueueCard(displayModel: QueueCardDisplayModel): string {
	return render(TEMPLATE, displayModel, { helpers: { eq } });
}
