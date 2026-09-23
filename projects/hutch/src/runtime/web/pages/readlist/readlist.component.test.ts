import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { generateCspNonce } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { deleteConfirmPopoverId } from "./readlist-card/delete-confirm.component";
import { markStatusConfirmPopoverId } from "./mark-status-confirm.component";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { READLIST_CREATE_PATH, type ReadlistUrlState } from "./readlist.url";
import type { ReadlistArticleViewModel, ReadlistViewModel } from "./readlist.viewmodel";
import { READLIST_RENAME_SCRIPT, readlistRenamePopoverId } from "./readlist-rename.component";
import { ReadlistPage, type ReadlistPageOptions } from "./readlist.component";

const WORK: Readlist = { slug: ReadlistSlugSchema.parse("work"), label: "Work Reading" };
const RAIL: ReadlistRailViewModel = {
	readlists: [DEFAULT_READLIST, WORK],
	activeReadlist: DEFAULT_READLIST,
	newReadlistAction: READLIST_CREATE_PATH,
	canCreate: true,
};
const DEFAULT_FILTERS: ReadlistUrlState = { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 1 };

const CONFIRMED_ARTICLE: ReadlistArticleViewModel = {
	id: "abc123",
	title: "Article Title",
	siteName: "example.com",
	excerpt: "An excerpt.",
	excerptSource: "generated",
	url: "https://example.com/article",
	status: "unread",
	isUnread: true,
	readTime: { value: "3", label: "~3 min read" },
	saved: { iso: "2025-06-01T12:50:00.000Z", label: "10m ago", mode: "relative" },
	actions: [],
	deleteConfirm: {
		articleId: "abc123",
		popoverId: deleteConfirmPopoverId("abc123"),
		url: "/queue/abc123/delete",
	},
	markStatusConfirm: {
		articleId: "abc123",
		popoverId: markStatusConfirmPopoverId("abc123"),
		url: "/queue/abc123/status",
		status: "read",
		queueLabels: ["All"],
	},
	readerHref: "/queue/abc123/view",
	isStalePending: false,
};

const PLAIN_ARTICLE: ReadlistArticleViewModel = {
	id: "def456",
	title: "Plain Article",
	siteName: "example.org",
	excerpt: "Another excerpt.",
	excerptSource: "generated",
	url: "https://example.org/plain",
	status: "unread",
	isUnread: true,
	readTime: undefined,
	saved: { iso: "2025-06-01T12:50:00.000Z", label: "10m ago", mode: "relative" },
	actions: [],
	readerHref: "/queue/def456/view",
	isStalePending: false,
};

function baseViewModel(overrides: Partial<ReadlistViewModel> = {}): ReadlistViewModel {
	return {
		articles: [],
		filters: DEFAULT_FILTERS,
		isEmpty: true,
		currentPage: 1,
		countsUrl: "/queue/counts",
		paginationUrls: {},
		subscriptionBanner: { state: "none" },
		accessIsReadOnly: false,
		...overrides,
	};
}

function pageOptions(overrides: Partial<ReadlistPageOptions> = {}): ReadlistPageOptions {
	return {
		cspNonce: generateCspNonce(),
		deviceClass: "desktop",
		readlistHoldsArticles: false,
		rail: RAIL,
		saveTip: { state: "due", html: "" },
		onboarding: {
			context: { hasInstallableClient: false },
			dismissed: false,
			completedBefore: false,
			completionUnearned: false,
		},
		query: {},
		...overrides,
	};
}

function buildPage(
	vmOverrides: Partial<ReadlistViewModel> = {},
	optOverrides: Partial<ReadlistPageOptions> = {},
) {
	return ReadlistPage(baseViewModel(vmOverrides), pageOptions(optOverrides));
}

function pageDoc(
	vmOverrides: Partial<ReadlistViewModel> = {},
	optOverrides: Partial<ReadlistPageOptions> = {},
): Document {
	return new JSDOM(buildPage(vmOverrides, optOverrides).content.html).window.document;
}

function emptyActionKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-empty-action]"), (action) =>
		action.getAttribute("data-test-empty-action"),
	);
}

function tabKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-filter]"), (tab) =>
		tab.getAttribute("data-test-filter"),
	);
}

function urlParams(href: string | null): URLSearchParams {
	return new URL(href ?? "", "https://internal.invalid").searchParams;
}

describe("ReadlistPage", () => {
	it("points the tab strip's request indicator at the strip, the pressed tab and the listing", () => {
		const doc = pageDoc();

		const tabs = doc.querySelector("[data-test-filters]");
		assert(tabs, "the design page must render its tab strip");
		expect(tabs.getAttribute("hx-indicator")).toBe(
			"closest .readlist-tabs, closest .readlist-tabs__link, .readlist-listing",
		);
	});

	it("marks the page as the design variant of the readlist", () => {
		const body = buildPage();

		expect(body.bodyClass).toBe("page-readlist");
	});

	it("shows the alert for a query the alert catalogue recognises", () => {
		const doc = pageDoc({}, { query: { queue_error: "limit" } });

		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert region must always render");
		expect(alert.classList.contains("readlist__alert--visible")).toBe(true);
		expect(doc.querySelector("[data-test-readlist-error-title]")?.textContent).toBe("Readlist limit reached");
	});

	it("hides the alert when the query carries no recognised error", () => {
		const doc = pageDoc({}, { query: {} });

		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert region must always render");
		expect(alert.classList.contains("readlist__alert--hidden")).toBe(true);
	});

	it("shows the save card on the All readlist", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: DEFAULT_READLIST_SLUG } });

		const card = doc.querySelector("[data-test-save-card]");
		assert(card, "the save card must always render");
		expect(card.classList.contains("readlist-save--visible")).toBe(true);
	});

	it("hides the save card on a custom readlist", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug } });

		const card = doc.querySelector("[data-test-save-card]");
		assert(card, "the save card must always render");
		expect(card.classList.contains("readlist-save--hidden")).toBe(true);
	});

	it("flags the save input invalid when the server rejected the url with a code", () => {
		const doc = pageDoc({ saveErrorCode: "malformed_url" });

		const input = doc.querySelector(".readlist-save__input");
		assert(input, "the save input must always render");
		expect(input.classList.contains("readlist-save__input--invalid")).toBe(true);
	});

	it("flags the save input invalid when validation left a field error", () => {
		const doc = pageDoc({ errors: [{ message: "That link isn't shaped like a URL." }] });

		const input = doc.querySelector(".readlist-save__input");
		assert(input, "the save input must always render");
		expect(input.classList.contains("readlist-save__input--invalid")).toBe(true);
	});

	it("keeps the save input valid when nothing is wrong with it", () => {
		const doc = pageDoc();

		const input = doc.querySelector(".readlist-save__input");
		assert(input, "the save input must always render");
		expect(input.classList.contains("readlist-save__input--valid")).toBe(true);
	});

	it("points every filter tab at its own listing", () => {
		const doc = pageDoc();

		const unread = doc.querySelector('[data-test-filter="unread"]');
		const read = doc.querySelector('[data-test-filter="read"]');
		assert(unread, "the To Read tab must render");
		assert(read, "the Read tab must render");
		expect(urlParams(unread.getAttribute("href")).get("tab")).toBe(null);
		expect(urlParams(read.getAttribute("href")).get("tab")).toBe("done");
	});

	it("labels the To Read tab with the count the shell already knows, without waiting for the counts fragment", () => {
		const doc = pageDoc({}, { knownUnreadCount: 5 });

		const unread = doc.querySelector('[data-test-filter="unread"] .readlist-tabs__label');
		assert(unread, "the To Read tab's label must render");
		expect(unread.textContent).toBe("To Read (5)");
	});

	it("sorts oldest first once the reader has reordered ascending", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, order: "asc" } });

		const sort = doc.querySelector("[data-test-sort]");
		assert(sort, "the sort control must render");
		expect(sort.textContent?.trim()).toBe("Oldest first");
	});

	it("disables the save form for a reader without write access", () => {
		const doc = pageDoc({ accessIsReadOnly: true });

		const form = doc.querySelector('[data-test-form="save-article"]');
		assert(form, "the save form must render");
		expect(form.classList.contains("readlist-save__form--disabled")).toBe(true);
	});

	it("points the counts loader at the counts route", () => {
		const doc = pageDoc({ countsUrl: "/queue/counts?tab=done" });

		const span = doc.getElementById("readlist-counts");
		assert(span, "the counts loader span must render");
		expect(span.getAttribute("hx-get")).toBe("/queue/counts?tab=done");
	});

	it("shows the exact unread count only on the first page with nothing more to load", () => {
		const doc = pageDoc({ articles: [PLAIN_ARTICLE], isEmpty: false, currentPage: 1, paginationUrls: {} });

		const label = doc.querySelector("#readlist-count");
		assert(label, "the count label must render");
		expect(label.textContent).toBe("1 Unread Article");
		const number = label.querySelector("[data-test-listing-count-number]");
		assert(number, "the count number span must render");
		expect(number.getAttribute("class")).toBe(
			"readlist__count-value readlist__count-value--known",
		);
	});

	it("names what the Read tab counts", () => {
		const doc = pageDoc({
			filters: { ...DEFAULT_FILTERS, tab: "done" },
			articles: [PLAIN_ARTICLE],
			isEmpty: false,
			currentPage: 1,
			paginationUrls: {},
		});

		const label = doc.querySelector("#readlist-count");
		assert(label, "the count label must render");
		expect(label.textContent).toBe("1 Read Article");
	});

	it("leaves the number pending once a next page exists, since the total isn't known yet", () => {
		const doc = pageDoc({
			articles: [PLAIN_ARTICLE],
			isEmpty: false,
			currentPage: 1,
			paginationUrls: { next: "/queue?page=2" },
		});

		const number = doc.querySelector("#readlist-count [data-test-listing-count-number]");
		const noun = doc.querySelector("#readlist-count [data-test-listing-count-noun]");
		assert(number, "the count number span must render");
		assert(noun, "the count noun span must render");
		expect(number.textContent).toBe("");
		expect(number.getAttribute("class")).toBe(
			"readlist__count-value readlist__count-value--pending",
		);
		expect(noun.textContent).toBe("Unread Articles");
	});

	it("leaves the number pending once the reader has paged forward", () => {
		const doc = pageDoc({
			articles: [PLAIN_ARTICLE],
			isEmpty: false,
			currentPage: 2,
			paginationUrls: { prev: "/queue" },
		});

		const number = doc.querySelector("#readlist-count [data-test-listing-count-number]");
		assert(number, "the count number span must render");
		expect(number.getAttribute("class")).toBe(
			"readlist__count-value readlist__count-value--pending",
		);
	});

	it("invites installing the extension when nothing has ever been saved to the default readlist", () => {
		const doc = pageDoc(
			{ filters: { ...DEFAULT_FILTERS, readlist: DEFAULT_READLIST_SLUG } },
			{ readlistHoldsArticles: false },
		);

		expect(doc.querySelector(".readlist-empty__title")?.textContent).toBe("Nothing saved yet");
		expect(doc.querySelector(".readlist-empty__text")?.textContent).toBe(
			"Save your first article by pasting a link above, or set up one-tap saving from your browser, phone, or AI assistant.",
		);
		expect(doc.querySelector("[data-test-empty-action='install']")?.textContent).toBe(
			"Set up one-tap saving",
		);
		expect(doc.querySelectorAll('[data-test-empty-action="install"]')).toHaveLength(1);
	});

	it("points a reader at All when their custom readlist holds no articles yet", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug } }, { readlistHoldsArticles: false });

		expect(doc.querySelector(".readlist-empty__title")?.textContent).toBe(
			"No articles in this readlist yet",
		);
		const action = doc.querySelector('[data-test-empty-action="open-default"]');
		assert(action, "the Go to All CTA must be offered");
		expect(action.textContent).toBe(`Go to ${DEFAULT_READLIST.label}`);
	});

	it("keeps one-tap saving in reach of a reader who is caught up on To Read", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, tab: "queue" } }, { readlistHoldsArticles: true });

		expect(doc.querySelector(".readlist-empty__title")?.textContent).toBe("You're all caught up");
		expect(emptyActionKeys(doc)).toEqual(["install"]);
		const install = doc.querySelector('[data-test-empty-action="install"]');
		assert(install, "the one-tap saving CTA must be offered");
		expect(install.getAttribute("href")).toBe(
			"/install?utm_source=queue-empty&utm_medium=internal&utm_content=install",
		);
	});

	it("points a reader at their unread articles when nothing is read yet", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, tab: "done" } }, { readlistHoldsArticles: true });

		expect(doc.querySelector(".readlist-empty__title")?.textContent).toBe("No finished articles yet");
		expect(emptyActionKeys(doc)).toEqual(["view-unread", "install"]);
		const action = doc.querySelector('[data-test-empty-action="view-unread"]');
		assert(action, "the View Unread Articles CTA must be offered");
		expect(urlParams(action.getAttribute("href")).get("utm_content")).toBe("view-unread");
	});

	it("sends a caught-up reader of a custom readlist back to the readlist that receives saves", () => {
		const doc = pageDoc(
			{ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug, tab: "queue" } },
			{ readlistHoldsArticles: true },
		);

		expect(emptyActionKeys(doc)).toEqual(["open-default"]);
	});

	it("offers the Preferences tab on a custom readlist the reader asked to configure", () => {
		const doc = pageDoc(
			{ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug } },
			{ query: { feature: "pref" } },
		);

		expect(tabKeys(doc)).toEqual(["unread", "read", "preferences"]);
		const preferences = doc.querySelector('[data-test-filter="preferences"]');
		assert(preferences, "the Preferences tab must render once it is asked for");
		const href = new URL(preferences.getAttribute("href") ?? "", "https://internal.invalid");
		expect(href.pathname).toBe(`/queue/queues/${WORK.slug}/preferences`);
		expect(href.searchParams.get("feature")).toBe("pref");
	});

	it("keeps the Preferences tab off the readlist every save lands in", () => {
		const doc = pageDoc({}, { query: { feature: "pref" } });

		expect(tabKeys(doc)).toEqual(["unread", "read"]);
	});

	it("keeps the Preferences tab out of a custom readlist until it is asked for", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug } });

		expect(tabKeys(doc)).toEqual(["unread", "read"]);
	});

	it("enables pagination controls when both directions exist", () => {
		const doc = pageDoc({
			articles: [PLAIN_ARTICLE],
			isEmpty: false,
			currentPage: 2,
			paginationUrls: { prev: "/queue?page=1", next: "/queue?page=3" },
		});

		const prev = doc.querySelector("[data-test-pagination-prev]");
		const next = doc.querySelector("[data-test-pagination-next]");
		assert(prev, "the previous-page control must render");
		assert(next, "the next-page control must render");
		expect(prev.classList.contains("readlist-pagination__link--enabled")).toBe(true);
		expect(next.classList.contains("readlist-pagination__link--enabled")).toBe(true);
		expect(urlParams(prev.getAttribute("href")).get("utm_content")).toBe("prev");
		expect(urlParams(next.getAttribute("href")).get("utm_content")).toBe("next");
	});

	it("renders the pagination controls as inert, unfocusable text when there is only one page", () => {
		const doc = pageDoc({ articles: [PLAIN_ARTICLE], isEmpty: false, paginationUrls: {} });

		const prev = doc.querySelector("[data-test-pagination-prev]");
		const next = doc.querySelector("[data-test-pagination-next]");
		assert(prev, "the previous-page control must render");
		assert(next, "the next-page control must render");
		expect(prev.tagName.toLowerCase()).toBe("span");
		expect(next.tagName.toLowerCase()).toBe("span");
		expect(prev.classList.contains("readlist-pagination__link--disabled")).toBe(true);
		expect(next.classList.contains("readlist-pagination__link--disabled")).toBe(true);
		expect(prev.getAttribute("aria-disabled")).toBe("true");
		expect(next.getAttribute("aria-disabled")).toBe("true");
	});

	it("offers the subscribe-plans popover during a trial countdown", () => {
		const doc = pageDoc({
			subscriptionBanner: {
				state: "trial-countdown",
				daysLeft: 2,
				daysLeftWord: "days",
				remaining: { days: 2, hours: 0, minutes: 0, seconds: 0, totalMs: 0 },
			},
		});

		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(1);
	});

	it("offers the subscribe-plans popover once the subscription has gone inactive", () => {
		const doc = pageDoc({ subscriptionBanner: { state: "inactive" } });

		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(1);
	});

	it("withholds the subscribe-plans popover during a scheduled cancellation", () => {
		const doc = pageDoc({
			subscriptionBanner: {
				state: "cancellation-scheduled",
				cancellationEffectiveAt: { iso: "2026-01-15T00:00:00.000Z", label: "Jan 15, 2026", mode: "date" },
			},
		});

		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(0);
	});

	it("withholds the subscribe-plans popover when the subscription needs no attention", () => {
		const doc = pageDoc({ subscriptionBanner: { state: "none" } });

		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(0);
	});

	it("illustrates the article delete confirmation and the readlist delete confirmation with the trash can", () => {
		const doc = pageDoc({ articles: [CONFIRMED_ARTICLE], isEmpty: false });

		const articleConfirm = doc.querySelector('[data-test-confirm-popover="delete"]');
		const readlistConfirm = doc.querySelector('[data-test-confirm-popover="readlist-delete"]');
		assert(articleConfirm, "the article delete confirmation must render");
		assert(readlistConfirm, "the readlist delete confirmation must render");
		expect(articleConfirm.classList.contains("confirm-popover--illustrated")).toBe(true);
		expect(readlistConfirm.classList.contains("confirm-popover--illustrated")).toBe(true);
		expect(articleConfirm.querySelectorAll(".confirm-popover__illustration svg")).toHaveLength(1);
		expect(readlistConfirm.querySelectorAll(".confirm-popover__illustration svg")).toHaveLength(1);
	});

	it("offers a rename popover for each readlist the reader owns", () => {
		const doc = pageDoc();

		const popover = doc.getElementById(readlistRenamePopoverId(WORK.slug));
		assert(popover, "the owned readlist's rename popover must render");
		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-rename"]')).toHaveLength(1);
	});

	it("withholds every rename and readlist-delete popover from a reader who cannot write", () => {
		const doc = pageDoc({}, { rail: { ...RAIL, canCreate: false } });

		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-rename"]')).toHaveLength(0);
		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-delete"]')).toHaveLength(0);
	});

	it("points the status toast's Undo action back at the article", () => {
		const doc = pageDoc({
			statusFlash: { message: "Marked as read", undoUrl: "/queue/abc123/status", undoStatus: "unread" },
		});

		const action = doc.querySelector("[data-test-toast-action]")?.closest("form");
		assert(action, "the status toast must post its Undo through a form");
		expect(urlParams(action.getAttribute("action")).get("utm_content")).toBe("undo");
	});

	it("shows which imported links were skipped and how many more there were", () => {
		const doc = pageDoc({
			importSkipped: {
				entries: [{ url: "https://example.com/x", reasonLabel: "Not an article" }],
				andMore: 3,
			},
		});

		const row = doc.querySelector("[data-test-import-skipped-row]");
		assert(row, "the skipped-imports panel must render a row per skipped link");
		expect(row.querySelector("[data-test-import-skipped-reason]")?.textContent).toBe("Not an article");
		expect(row.querySelector("[data-test-import-skipped-url]")?.textContent).toBe("https://example.com/x");
		expect(doc.querySelector("[data-test-import-skipped-more]")?.textContent).toBe("And 3 more.");
	});

	it("resubmits a pending save once the page loads, only when a save is actually pending", () => {
		const withUrl = buildPage({}, { saveUrl: "https://example.com/x" });
		const withoutUrl = buildPage();
		assert(withUrl.scripts, "the page must ship its scripts");
		assert(withoutUrl.scripts, "the page must ship its scripts");

		expect(withUrl.scripts.includes("requestSubmit")).toBe(true);
		expect(withoutUrl.scripts.includes("requestSubmit")).toBe(false);
	});

	it("ships the design client script that drives the nav menus and the rename panel", () => {
		const body = buildPage();
		assert(body.scripts, "the page must ship its scripts");

		expect(body.scripts.includes(READLIST_RENAME_SCRIPT)).toBe(true);
	});
});
