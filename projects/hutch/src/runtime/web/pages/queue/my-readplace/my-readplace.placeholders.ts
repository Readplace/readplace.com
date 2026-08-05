import type { DeviceClass } from "@packages/web-analytics";
import { toRelativeOrDate } from "@packages/web-shell";

import { deleteConfirmPopoverId } from "../queue-card/delete-confirm";
import {
	renderQueueCard,
	toQueueCardDisplayModel,
	type QueueCardDisplayModel,
} from "../queue-card/queue-card.component";
import type { ArticleAction, QueueArticleViewModel } from "../queue.viewmodel";

const INERT_URL = "#";

const PLACEHOLDER_ACTIONS: ArticleAction[] = [
	{
		method: "POST",
		url: INERT_URL,
		text: "Mark as read",
		title: "Mark as read",
		testAction: "mark-read",
		fields: [],
	},
	{
		method: "POST",
		url: INERT_URL,
		text: "Delete",
		iconName: "x",
		title: "Delete",
		testAction: "delete",
		fields: [],
	},
];

interface PlaceholderArticle {
	id: string;
	title: string;
	siteName: string;
	excerpt: string;
	url: string;
	savedHoursAgo: number;
}

const PLACEHOLDER_ARTICLES: readonly PlaceholderArticle[] = [
	{
		id: "my-readplace-sample-1",
		title: "The Grug Brained Developer",
		siteName: "grugbrain.dev",
		excerpt:
			"A layman's guide to thinking like the self-aware smol brained, and why complexity is the eternal enemy of the working programmer.",
		url: "https://grugbrain.dev/",
		savedHoursAgo: 3,
	},
	{
		id: "my-readplace-sample-2",
		title: "Choose Boring Technology",
		siteName: "mcfunley.com",
		excerpt:
			"Every organisation gets a limited number of innovation tokens. Spending them on the parts nobody sees is how teams run out of room to innovate where it counts.",
		url: "https://mcfunley.com/choose-boring-technology",
		savedHoursAgo: 27,
	},
	{
		id: "my-readplace-sample-3",
		title: "Hypermedia Systems",
		siteName: "hypermedia.systems",
		excerpt:
			"What the web would look like if we took hypermedia seriously — HTML as the engine of application state, and what that buys back from the JavaScript era.",
		url: "https://hypermedia.systems/",
		savedHoursAgo: 74,
	},
];

const HOUR_MS = 60 * 60 * 1000;

function toPlaceholderViewModel(
	article: PlaceholderArticle,
	now: Date,
): QueueArticleViewModel {
	return {
		id: article.id,
		title: article.title,
		siteName: article.siteName,
		excerpt: article.excerpt,
		url: article.url,
		status: "unread",
		isUnread: true,
		saved: toRelativeOrDate({
			iso: new Date(now.getTime() - article.savedHoursAgo * HOUR_MS).toISOString(),
			now,
		}),
		actions: PLACEHOLDER_ACTIONS,
		deleteConfirm: {
			articleId: article.id,
			popoverId: deleteConfirmPopoverId(article.id),
			url: INERT_URL,
		},
		isStalePending: false,
	};
}

function toInertCard(card: QueueCardDisplayModel): QueueCardDisplayModel {
	return {
		...card,
		titleLinkUrl: INERT_URL,
		excerptLinkUrl: INERT_URL,
		thumbnailLinkUrl: INERT_URL,
		actions: card.actions.map((action) => ({ ...action, url: INERT_URL, disabled: true })),
		deleteTriggerDisabled: true,
	};
}

export function renderPlaceholderCards(options: {
	now: Date;
	deviceClass: DeviceClass;
}): string[] {
	return PLACEHOLDER_ARTICLES.map((article) =>
		renderQueueCard(
			toInertCard(
				toQueueCardDisplayModel(toPlaceholderViewModel(article, options.now), {
					isFirst: false,
					deviceClass: options.deviceClass,
				}),
			),
		),
	);
}
