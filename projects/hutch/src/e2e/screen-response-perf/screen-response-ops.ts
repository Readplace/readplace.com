export const SCREEN_RESPONSE_OP_IDS = [
	"readlist-switch-first",
	"readlist-switch-subsequent",
	"tab-switch-first",
	"tab-switch-subsequent",
	"assign-to-readlist",
	"open-article",
	"back-to-readlist",
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

export const DEFAULT_READLIST_SLUG = "default";

export const READLIST_NAV = "nav[data-test-readlist-nav]";
export const READLIST_FILTERS = "nav[data-test-filters]";
export const ARTICLE_CARD = "[data-test-article]";
export const EMPTY_READLIST = "[data-test-empty-readlist]";
export const READLIST_COUNTS = "[data-test-readlist-counts]";
export const ARTICLE_HEADER = "#article-header";
export const READER_SLOT_READY = '[data-test-reader-slot][data-reader-status="ready"]';
export const READER_CONTENT = "[data-test-reader-content]";
export const READER_TITLE = "[data-test-reader-title]";
export const BACK_LINK = "a[data-test-back-link]";
export const READLISTS_TRIGGER = "summary[data-test-readlists-trigger]";
export const REPEATING_POLLER = '[hx-trigger*="every"]';

export function readlistNavLink(slug: string): string {
	return `${READLIST_NAV} a[data-test-readlist="${slug}"]`;
}

const TAB_TEST_FILTERS = {
	queue: "unread",
	done: "read",
} satisfies Record<TabId, string>;

export function filterLink(tab: TabId): string {
	return `${READLIST_FILTERS} a[data-test-filter="${TAB_TEST_FILTERS[tab]}"]`;
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
	return `button[data-test-assign-readlist="${slug}"]`;
}

export function readlistTag(slug: string): string {
	return `${ARTICLE_HEADER} [data-test-readlist-tag="${slug}"]`;
}

export function unassignButton(slug: string): string {
	return `${readlistTag(slug)} button[data-test-unassign-readlist="${slug}"]`;
}

function listingSettled(activeLink: string): ScreenResponsePredicate {
	return {
		required: [{ selector: `${activeLink}[aria-current="page"]`, laidOut: true }],
		oneOf: [
			{ selector: ARTICLE_CARD, laidOut: true },
			{ selector: EMPTY_READLIST, laidOut: true },
		],
	};
}

export function readlistSwitchOp(input: {
	id: Extract<ScreenResponseOpId, "readlist-switch-first" | "readlist-switch-subsequent">;
	slug: string;
}): ScreenResponseOp {
	return {
		id: input.id,
		trigger: readlistNavLink(input.slug),
		predicate: listingSettled(readlistNavLink(input.slug)),
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
		id: "assign-to-readlist",
		trigger: assignButton(input.slug),
		predicate: {
			required: [{ selector: readlistTag(input.slug), laidOut: true }],
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
		navigation: "same-document",
	};
}

export function backToReadlistOp(): ScreenResponseOp {
	return {
		id: "back-to-readlist",
		trigger: BACK_LINK,
		predicate: listingSettled(readlistNavLink(DEFAULT_READLIST_SLUG)),
		expectedOneOf: ARTICLE_CARD,
		navigation: "new-document",
	};
}
