export const SCREEN_RESPONSE_OP_IDS = [
	"queue-switch-first",
	"queue-switch-subsequent",
	"tab-switch-first",
	"tab-switch-subsequent",
	"assign-to-queue",
	"open-article",
	"back-to-queue",
] as const;

export type ScreenResponseOpId = (typeof SCREEN_RESPONSE_OP_IDS)[number];

export type NavigationKind = "same-document" | "new-document";

export type TabId = "queue" | "done";

export interface ElementCondition {
	readonly selector: string;
	readonly laidOut: boolean;
}

export interface ScreenResponsePredicate {
	readonly required: readonly ElementCondition[];
	readonly oneOf: readonly ElementCondition[];
}

export interface ScreenResponseOp {
	readonly id: ScreenResponseOpId;
	readonly trigger: string;
	readonly predicate: ScreenResponsePredicate;
	readonly expectedOneOf: string;
	readonly navigation: NavigationKind;
}

export const DEFAULT_QUEUE_SLUG = "default";

export const QUEUE_NAV = "nav[data-test-queue-nav]";
export const QUEUE_FILTERS = "nav[data-test-filters]";
export const ARTICLE_CARD = "[data-test-article]";
export const EMPTY_QUEUE = "[data-test-empty-queue]";
export const QUEUE_COUNTS = "[data-test-queue-counts]";
export const ARTICLE_HEADER = "#article-header";
export const READER_SLOT_READY = '[data-test-reader-slot][data-reader-status="ready"]';
export const READER_CONTENT = "[data-test-reader-content]";
export const READER_TITLE = "[data-test-reader-title]";
export const BACK_LINK = "a[data-test-back-link]";
export const QUEUES_TRIGGER = "summary[data-test-queues-trigger]";
export const REPEATING_POLLER = '[hx-trigger*="every"]';

export function queueNavLink(slug: string): string {
	return `${QUEUE_NAV} a[data-test-queue="${slug}"]`;
}

const TAB_TEST_FILTERS = {
	queue: "unread",
	done: "read",
} satisfies Record<TabId, string>;

export function filterLink(tab: TabId): string {
	return `${QUEUE_FILTERS} a[data-test-filter="${TAB_TEST_FILTERS[tab]}"]`;
}

export function articleCard(articleId: string): string {
	return `[data-test-article="${articleId}"]`;
}

export function articleTitleLink(articleId: string): string {
	return `${articleCard(articleId)} a[data-test-article-title]`;
}

export function terminalCard(articleId: string): string {
	return `${articleCard(articleId)}[data-card-status="terminal"]`;
}

export function assignButton(slug: string): string {
	return `button[data-test-assign-queue="${slug}"]`;
}

export function queueTag(slug: string): string {
	return `${ARTICLE_HEADER} [data-test-queue-tag="${slug}"]`;
}

export function unassignButton(slug: string): string {
	return `${queueTag(slug)} button[data-test-unassign-queue="${slug}"]`;
}

function listingSettled(activeLink: string): ScreenResponsePredicate {
	return {
		required: [{ selector: `${activeLink}[aria-current="page"]`, laidOut: true }],
		oneOf: [
			{ selector: ARTICLE_CARD, laidOut: true },
			{ selector: EMPTY_QUEUE, laidOut: true },
		],
	};
}

export function queueSwitchOp(input: {
	id: Extract<ScreenResponseOpId, "queue-switch-first" | "queue-switch-subsequent">;
	slug: string;
}): ScreenResponseOp {
	return {
		id: input.id,
		trigger: queueNavLink(input.slug),
		predicate: listingSettled(queueNavLink(input.slug)),
		expectedOneOf: ARTICLE_CARD,
		navigation: "same-document",
	};
}

export function tabSwitchOp(input: {
	id: Extract<ScreenResponseOpId, "tab-switch-first" | "tab-switch-subsequent">;
	tab: TabId;
}): ScreenResponseOp {
	return {
		id: input.id,
		trigger: filterLink(input.tab),
		predicate: listingSettled(filterLink(input.tab)),
		expectedOneOf: ARTICLE_CARD,
		navigation: "same-document",
	};
}

export function assignOp(input: { slug: string }): ScreenResponseOp {
	return {
		id: "assign-to-queue",
		trigger: assignButton(input.slug),
		predicate: {
			required: [{ selector: queueTag(input.slug), laidOut: true }],
			oneOf: [{ selector: READER_CONTENT, laidOut: true }],
		},
		expectedOneOf: READER_CONTENT,
		navigation: "same-document",
	};
}

export function openArticleOp(input: { articleId: string }): ScreenResponseOp {
	return {
		id: "open-article",
		trigger: articleTitleLink(input.articleId),
		predicate: {
			required: [
				{ selector: READER_SLOT_READY, laidOut: true },
				{ selector: `${ARTICLE_HEADER} ${READER_TITLE}`, laidOut: true },
			],
			oneOf: [{ selector: READER_CONTENT, laidOut: true }],
		},
		expectedOneOf: READER_CONTENT,
		navigation: "new-document",
	};
}

export function backToQueueOp(): ScreenResponseOp {
	return {
		id: "back-to-queue",
		trigger: BACK_LINK,
		predicate: listingSettled(queueNavLink(DEFAULT_QUEUE_SLUG)),
		expectedOneOf: ARTICLE_CARD,
		navigation: "new-document",
	};
}
