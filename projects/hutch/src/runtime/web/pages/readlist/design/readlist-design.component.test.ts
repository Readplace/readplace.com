import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { generateCspNonce } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import type { ReadlistRailViewModel } from "../readlist.component";
import { deleteConfirmPopoverId } from "../readlist-card/delete-confirm.component";
import { markStatusConfirmPopoverId } from "../mark-status-confirm.component";
import { DEFAULT_READLIST, type Readlist } from "../readlist.nav";
import { READLIST_CREATE_PATH, type ReadlistUrlState } from "../readlist.url";
import type { ReadlistArticleViewModel, ReadlistViewModel } from "../readlist.viewmodel";
import { READLIST_DESIGN_RENAME_SCRIPT, readlistDesignRenamePopoverId } from "./readlist-design-rename.component";
import { ReadlistDesignPage, type ReadlistDesignPageOptions } from "./readlist-design.component";

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

function pageOptions(overrides: Partial<ReadlistDesignPageOptions> = {}): ReadlistDesignPageOptions {
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
	optOverrides: Partial<ReadlistDesignPageOptions> = {},
) {
	return ReadlistDesignPage(baseViewModel(vmOverrides), pageOptions(optOverrides));
}

function pageDoc(
	vmOverrides: Partial<ReadlistViewModel> = {},
	optOverrides: Partial<ReadlistDesignPageOptions> = {},
): Document {
	return new JSDOM(buildPage(vmOverrides, optOverrides).content.html).window.document;
}

function urlParams(href: string | null): URLSearchParams {
	return new URL(href ?? "", "https://internal.invalid").searchParams;
}

describe("ReadlistDesignPage", () => {
	it("marks the page as the design variant of the readlist", () => {
		const body = buildPage();

		expect(body.bodyClass).toBe("page-readlist page-readlist-design");
	});

	it("shows the alert for a query the alert catalogue recognises", () => {
		const doc = pageDoc({}, { query: { queue_error: "limit" } });

		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert region must always render");
		expect(alert.classList.contains("readlist-design__alert--visible")).toBe(true);
		expect(doc.querySelector("[data-test-readlist-error-title]")?.textContent).toBe("Readlist limit reached");
	});

	it("hides the alert when the query carries no recognised error", () => {
		const doc = pageDoc({}, { query: {} });

		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert region must always render");
		expect(alert.classList.contains("readlist-design__alert--hidden")).toBe(true);
	});

	it("shows the save card on the All readlist", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: DEFAULT_READLIST_SLUG } });

		const card = doc.querySelector("[data-test-save-card]");
		assert(card, "the save card must always render");
		expect(card.classList.contains("readlist-design-save--visible")).toBe(true);
	});

	it("hides the save card on a custom readlist", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug } });

		const card = doc.querySelector("[data-test-save-card]");
		assert(card, "the save card must always render");
		expect(card.classList.contains("readlist-design-save--hidden")).toBe(true);
	});

	it("flags the save input invalid when the server rejected the url with a code", () => {
		const doc = pageDoc({ saveErrorCode: "malformed_url" });

		const input = doc.querySelector(".readlist-design-save__input");
		assert(input, "the save input must always render");
		expect(input.classList.contains("readlist-design-save__input--invalid")).toBe(true);
	});

	it("flags the save input invalid when validation left a field error", () => {
		const doc = pageDoc({ errors: [{ message: "That link isn't shaped like a URL." }] });

		const input = doc.querySelector(".readlist-design-save__input");
		assert(input, "the save input must always render");
		expect(input.classList.contains("readlist-design-save__input--invalid")).toBe(true);
	});

	it("keeps the save input valid when nothing is wrong with it", () => {
		const doc = pageDoc();

		const input = doc.querySelector(".readlist-design-save__input");
		assert(input, "the save input must always render");
		expect(input.classList.contains("readlist-design-save__input--valid")).toBe(true);
	});

	it("carries the design flag on every filter tab link", () => {
		const doc = pageDoc();

		const unread = doc.querySelector('[data-test-filter="unread"]');
		const read = doc.querySelector('[data-test-filter="read"]');
		assert(unread, "the To Read tab must render");
		assert(read, "the Read tab must render");
		expect(urlParams(unread.getAttribute("href")).get("feature")).toBe("design");
		expect(urlParams(read.getAttribute("href")).get("feature")).toBe("design");
	});

	it("labels the To Read tab with the count the shell already knows, without waiting for the counts fragment", () => {
		const doc = pageDoc({}, { knownUnreadCount: 5 });

		const unread = doc.querySelector('[data-test-filter="unread"] .readlist-design-tabs__label');
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
		expect(form.classList.contains("readlist-design-save__form--disabled")).toBe(true);
	});

	it("carries the design flag on the counts loader's URL", () => {
		const doc = pageDoc({ countsUrl: "/queue/counts?tab=done" });

		const span = doc.getElementById("readlist-counts");
		assert(span, "the counts loader span must render");
		expect(urlParams(span.getAttribute("hx-get")).get("feature")).toBe("design");
	});

	it("shows the exact saved count only on the first page with nothing more to load", () => {
		const doc = pageDoc({ articles: [PLAIN_ARTICLE], isEmpty: false, currentPage: 1, paginationUrls: {} });

		const label = doc.querySelector("#readlist-design-count");
		assert(label, "the count label must render");
		expect(label.textContent).toBe("1 Saved Article");
	});

	it("falls back to a plain label once a next page exists, since the total isn't known yet", () => {
		const doc = pageDoc({
			articles: [PLAIN_ARTICLE],
			isEmpty: false,
			currentPage: 1,
			paginationUrls: { next: "/queue?page=2" },
		});

		const label = doc.querySelector("#readlist-design-count");
		assert(label, "the count label must render");
		expect(label.textContent).toBe("Saved Articles");
	});

	it("falls back to a plain label once the reader has paged forward", () => {
		const doc = pageDoc({
			articles: [PLAIN_ARTICLE],
			isEmpty: false,
			currentPage: 2,
			paginationUrls: { prev: "/queue" },
		});

		const label = doc.querySelector("#readlist-design-count");
		assert(label, "the count label must render");
		expect(label.textContent).toBe("Saved Articles");
	});

	it("invites installing the extension when nothing has ever been saved to the default readlist", () => {
		const doc = pageDoc(
			{ filters: { ...DEFAULT_FILTERS, readlist: DEFAULT_READLIST_SLUG } },
			{ readlistHoldsArticles: false },
		);

		expect(doc.querySelector(".readlist-design-empty__title")?.textContent).toBe("Nothing saved yet");
		expect(doc.querySelectorAll('[data-test-empty-action="install"]')).toHaveLength(1);
	});

	it("points a reader at All when their custom readlist holds no articles yet", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug } }, { readlistHoldsArticles: false });

		expect(doc.querySelector(".readlist-design-empty__title")?.textContent).toBe(
			"No articles in this readlist yet",
		);
		const action = doc.querySelector('[data-test-empty-action="open-default"]');
		assert(action, "the Go to All CTA must be offered");
		expect(action.textContent).toBe(`Go to ${DEFAULT_READLIST.label}`);
	});

	it("offers no call to action once a reader is caught up on To Read", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, tab: "queue" } }, { readlistHoldsArticles: true });

		expect(doc.querySelector(".readlist-design-empty__title")?.textContent).toBe("You're all caught up");
		expect(doc.querySelectorAll("[data-test-empty-action]")).toHaveLength(0);
	});

	it("points a reader at their unread articles, tagged with the design flag, when nothing is read yet", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, tab: "done" } }, { readlistHoldsArticles: true });

		expect(doc.querySelector(".readlist-design-empty__title")?.textContent).toBe("No finished articles yet");
		const action = doc.querySelector('[data-test-empty-action="view-unread"]');
		assert(action, "the View Unread Articles CTA must be offered");
		expect(urlParams(action.getAttribute("href")).get("feature")).toBe("design");
	});

	it("enables pagination controls and carries the design flag when both directions exist", () => {
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
		expect(prev.classList.contains("readlist-design-pagination__link--enabled")).toBe(true);
		expect(next.classList.contains("readlist-design-pagination__link--enabled")).toBe(true);
		expect(urlParams(prev.getAttribute("href")).get("feature")).toBe("design");
		expect(urlParams(next.getAttribute("href")).get("feature")).toBe("design");
	});

	it("renders the pagination controls as inert, unfocusable text when there is only one page", () => {
		const doc = pageDoc({ articles: [PLAIN_ARTICLE], isEmpty: false, paginationUrls: {} });

		const prev = doc.querySelector("[data-test-pagination-prev]");
		const next = doc.querySelector("[data-test-pagination-next]");
		assert(prev, "the previous-page control must render");
		assert(next, "the next-page control must render");
		expect(prev.tagName.toLowerCase()).toBe("span");
		expect(next.tagName.toLowerCase()).toBe("span");
		expect(prev.classList.contains("readlist-design-pagination__link--disabled")).toBe(true);
		expect(next.classList.contains("readlist-design-pagination__link--disabled")).toBe(true);
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

		const popover = doc.getElementById(readlistDesignRenamePopoverId(WORK.slug));
		assert(popover, "the owned readlist's rename popover must render");
		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-rename"]')).toHaveLength(1);
	});

	it("withholds every rename and readlist-delete popover from a reader who cannot write", () => {
		const doc = pageDoc({}, { rail: { ...RAIL, canCreate: false } });

		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-rename"]')).toHaveLength(0);
		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-delete"]')).toHaveLength(0);
	});

	it("carries the design flag on the status toast's Undo action", () => {
		const doc = pageDoc({
			statusFlash: { message: "Marked as read", undoUrl: "/queue/abc123/status", undoStatus: "unread" },
		});

		const action = doc.querySelector("[data-test-toast-action]")?.closest("form");
		assert(action, "the status toast must post its Undo through a form");
		expect(urlParams(action.getAttribute("action")).get("feature")).toBe("design");
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

		expect(body.scripts.includes(READLIST_DESIGN_RENAME_SCRIPT)).toBe(true);
	});
});
