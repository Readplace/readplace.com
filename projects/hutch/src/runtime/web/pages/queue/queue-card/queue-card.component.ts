import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { DeviceClass } from "@packages/web-analytics";
import type { IconName } from "@packages/ui-icons";
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

export interface ConfirmTriggerDisplayModel {
	popoverId: string;
	title: string;
	text: string;
	testAction: string;
	buttonClass: string;
	iconName?: IconName;
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
	readTimeLabel: string;
	readTimeEmptyClass: string;
	siteSepClass: string;
	readTimeSepClass: string;
	savedSepClass: string;
	actions: ActionDisplayModel[];
	confirmTriggers: ConfirmTriggerDisplayModel[];
}

const SEP_CLASS = " queue-article__meta-part--sep";

function toMetaSeparators(present: { site: boolean; readTime: boolean }) {
	const order = [present.site, present.readTime, true];
	const firstPresent = order.indexOf(true);
	const sepFor = (index: number) => (order[index] && index > firstPresent ? SEP_CLASS : "");
	return {
		siteSepClass: sepFor(0),
		readTimeSepClass: sepFor(1),
		savedSepClass: sepFor(2),
	};
}

const ACTION_VARIANTS = {
	status: {
		buttonClass: "queue-article__action-btn queue-article__action-btn--status",
		fallbackClass: "queue-article__status-fallback",
		affordance: "with-loader",
	},
	delete: {
		buttonClass: "queue-article__action-btn queue-article__action-btn--delete",
		fallbackClass: "queue-article__delete-fallback",
		affordance: "bare",
	},
} as const satisfies Record<
	string,
	{ buttonClass: string; fallbackClass: string; affordance: ActionDisplayModel["affordance"] }
>;

function variantOf(action: ArticleAction) {
	return action.testAction === "delete" ? ACTION_VARIANTS.delete : ACTION_VARIANTS.status;
}

export function toActionDisplayModel(
	action: ArticleAction,
	options: { isProcessing: boolean; articleId: string },
): ActionDisplayModel {
	const isConfirmed = action.confirmPopoverId !== undefined;
	const variant = variantOf(action);
	const showsLoader = variant.affordance === "with-loader";
	return {
		...action,
		url: withInternalTracking(action.url, { source: "queue-card", content: action.testAction }),
		testAction: isConfirmed ? `${action.testAction}-fallback` : action.testAction,
		buttonClass: variant.buttonClass,
		formClass: isConfirmed
			? `queue-article__action-form ${variant.fallbackClass}`
			: "queue-article__action-form",
		disabled: options.isProcessing && showsLoader,
		affordance: variant.affordance,
		buttonId: showsLoader ? `queue-status-${options.articleId}` : undefined,
	};
}

export function toQueueCardDisplayModel(
	article: QueueArticleViewModel,
	options: { isFirst: boolean; deviceClass: DeviceClass },
): QueueCardDisplayModel {
	const isProcessing = Boolean(article.cardPollUrl);
	const openReaderLink = (content: string) =>
		withInternalTracking(article.readerHref, {
			source: "queue-card",
			content,
			term: options.deviceClass,
		});
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
		readTimeLabel: article.readTime?.label ?? "",
		readTimeEmptyClass: article.readTime ? "" : " queue-article__read-time--empty",
		...toMetaSeparators({
			site: Boolean(article.siteName),
			readTime: article.readTime !== undefined,
		}),
		actions: article.actions.map((action) =>
			toActionDisplayModel(action, { isProcessing, articleId: article.id }),
		),
		confirmTriggers: article.actions.flatMap((action) =>
			action.confirmPopoverId === undefined
				? []
				: [
						{
							popoverId: action.confirmPopoverId,
							title: action.title,
							text: action.text,
							testAction: action.testAction,
							buttonClass: variantOf(action).buttonClass,
							...(action.iconName === undefined ? {} : { iconName: action.iconName }),
						},
					],
		),
	};
}

/** Lets the template branch on the `affordance` string enum
 * (`{{#if (eq affordance "with-loader")}}`); Handlebars has no built-in equality. */
const eq = (a: unknown, b: unknown): boolean => a === b;

export function renderQueueCard(displayModel: QueueCardDisplayModel): string {
	return render(TEMPLATE, displayModel, { helpers: { eq } });
}
