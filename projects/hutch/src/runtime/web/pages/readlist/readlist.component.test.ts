import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { iconSvg } from "@packages/ui-icons";
import { generateCspNonce } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import type { InstallableClientOnboarding, OnboardingContext } from "../../onboarding/onboarding.types";
import type { ReadlistRailViewModel } from "./readlist-rail";
import { deleteConfirmPopoverId } from "./readlist-card/delete-confirm.component";
import { markStatusConfirmPopoverId } from "./mark-status-confirm.component";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { READLIST_CREATE_PATH, type ReadlistUrlState } from "./readlist.url";
import type { ReadlistArticleViewModel, ReadlistViewModel } from "./readlist.viewmodel";
import { readlistRenamePopoverId } from "./readlist-rename.component";
import { READLIST_CLIENT_SCRIPT } from "./readlist-name-form.component";
import { OFFLINE_DOWNLOAD_SCRIPT } from "../../shared/offline-reader/offline-download-script";
import { ReadlistPage, type ReadlistPageOptions } from "./readlist.component";

const WORK: Readlist = { slug: ReadlistSlugSchema.parse("work"), label: "Work Reading" };
const RAIL: ReadlistRailViewModel = {
	readlists: [DEFAULT_READLIST, WORK],
	activeReadlist: DEFAULT_READLIST,
	newReadlistAction: READLIST_CREATE_PATH,
	canCreate: true,
	nonEmptyReadlists: [],
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
	readTime: { value: "3", label: "3 min read" },
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
		readlists: [{ slug: ReadlistSlugSchema.parse("default"), label: "All" }],
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

function installableClient(
	overrides: Partial<Omit<InstallableClientOnboarding, "hasInstallableClient">>,
): InstallableClientOnboarding {
	return {
		hasInstallableClient: true,
		installed: false,
		savedArticle: false,
		savedCount: 0,
		platform: "chrome",
		inboxArticleQueued: false,
		emailStepMarkedDone: false,
		...overrides,
	};
}

function onboardingWith(context: OnboardingContext): ReadlistPageOptions["onboarding"] {
	return { context, dismissed: false, completedBefore: false, completionUnearned: false };
}

function buildPage(
	vmOverrides: Partial<ReadlistViewModel> = {},
	optOverrides: Partial<ReadlistPageOptions> = {},
) {
	return ReadlistPage(baseViewModel(vmOverrides), pageOptions(optOverrides));
}

describe("readlist menu styles", () => {
	it("ships the shared panel and row styles with the readlist page", () => {
		const styles = buildPage().styles;
		expect(styles).toContain(".menu__panel {");
		expect(styles).toContain(".menu__item {");
	});

	it("ships the shared readlist row styles with the readlist page", () => {
		const styles = buildPage().styles;
		expect(styles).toContain(".readlist-row {");
		expect(styles).toContain(".readlist-row--selected {");
	});
});

function pageDoc(
	vmOverrides: Partial<ReadlistViewModel> = {},
	optOverrides: Partial<ReadlistPageOptions> = {},
): Document {
	return new JSDOM(buildPage(vmOverrides, optOverrides).content.html).window.document;
}

function saveInput(doc: Document): HTMLInputElement {
	const input = doc.querySelector<HTMLInputElement>('[data-test-form="save-article"] input[name="url"]');
	assert(input, "the save input must always render");
	return input;
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

function offlineDownload(doc: Document): HTMLElement {
	const control = doc.querySelector<HTMLElement>("[data-test-offline-download]");
	assert(control, "the unread download control must always render");
	return control;
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
			"closest .underline-tabs, closest .underline-tabs__tab, .readlist-listing",
		);
	});

	it("marks the page as the design variant of the readlist", () => {
		const body = buildPage();

		expect(body.bodyClass).toBe("page-readlist");
	});

	it("shows the alert for a query the alert catalogue recognises", () => {
		const doc = pageDoc({}, { query: { queue_error: "limit" } });

		const alert = doc.querySelector('[data-test-alert="readlist"]');
		assert(alert, "the alert region must always render");
		expect(alert.classList.contains("alert--visible")).toBe(true);
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe("Readlist limit reached");
	});

	it("hides the alert when the query carries no recognised error", () => {
		const doc = pageDoc({}, { query: {} });

		const alert = doc.querySelector('[data-test-alert="readlist"]');
		assert(alert, "the alert region must always render");
		expect(alert.classList.contains("alert--hidden")).toBe(true);
	});

	it("renders the save card, posting to the default readlist, on a custom readlist", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug } });
		const card = doc.querySelector("[data-test-save-card]");
		assert(card, "the save card must render on a custom readlist");
		const form = card.querySelector('[data-test-form="save-article"]');
		assert(form, "the save card must submit through a form");
		const action = form.getAttribute("action");
		assert(action, "the save form must have a destination");
		const url = new URL(action, "https://internal.invalid");
		expect(url.pathname).toBe("/queue/save");
		expect(url.searchParams.has("queue")).toBe(false);
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

	it("labels the filter tabs without a count", () => {
		const doc = pageDoc();

		const labels = Array.from(doc.querySelectorAll("[data-test-filter] .underline-tabs__label"), (label) =>
			label.textContent,
		);
		expect(labels).toEqual(["To Read", "Read"]);
	});

	it("sorts oldest first once the reader has reordered ascending", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, order: "asc" } });

		const sort = doc.querySelector("[data-test-sort]");
		assert(sort, "the sort control must render");
		expect(sort.textContent?.trim()).toBe("Oldest first");
	});

	it("disables the save input for a reader without write access", () => {
		const doc = pageDoc({ accessIsReadOnly: true });

		expect(saveInput(doc).disabled).toBe(true);
	});

	it("leaves the save input enabled for a reader with write access", () => {
		const doc = pageDoc({ accessIsReadOnly: false });

		expect(saveInput(doc).disabled).toBe(false);
	});

	it("points the counts loader at the counts route", () => {
		const doc = pageDoc({ countsUrl: "/queue/counts?tab=done" });

		const span = doc.getElementById("readlist-counts");
		assert(span, "the counts loader span must render");
		expect(span.getAttribute("hx-get")).toBe("/queue/counts?tab=done");
	});

	it("shows the exact saved count only on the first page with nothing more to load", () => {
		const doc = pageDoc({ articles: [PLAIN_ARTICLE], isEmpty: false, currentPage: 1, paginationUrls: {} });

		const label = doc.querySelector("#readlist-count");
		assert(label, "the count label must render");
		expect(label.textContent).toBe("1 Saved Article");
		const number = label.querySelector("[data-test-listing-count-number]");
		assert(number, "the count number span must render");
		expect(number.getAttribute("class")).toBe(
			"readlist__count-value readlist__count-value--known",
		);
	});

	it("keeps the saved noun on the Read tab", () => {
		const doc = pageDoc({
			filters: { ...DEFAULT_FILTERS, tab: "done" },
			articles: [PLAIN_ARTICLE],
			isEmpty: false,
			currentPage: 1,
			paginationUrls: {},
		});

		const label = doc.querySelector("#readlist-count");
		assert(label, "the count label must render");
		expect(label.textContent).toBe("1 Saved Article");
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
		expect(noun.textContent).toBe("Saved Articles");
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

	it.each([
		{
			device: "a device with no installable client",
			context: { hasInstallableClient: false } as const,
			text: "Save your first article by pasting a link above, or set up one-tap saving from your browser, phone, or AI assistant.",
			label: "Set up one-tap saving",
			client: null,
		},
		{
			device: "Chrome",
			context: installableClient({ platform: "chrome" }),
			text: "Save your first article by pasting a link above, or use the Readplace browser extension to save it in one click.",
			label: "Install Chrome extension",
			client: "chrome",
		},
		{
			device: "Firefox",
			context: installableClient({ platform: "firefox" }),
			text: "Save your first article by pasting a link above, or use the Readplace browser extension to save it in one click.",
			label: "Install Firefox extension",
			client: "firefox",
		},
		{
			device: "iPhone",
			context: installableClient({ platform: "iphone" }),
			text: "Save your first article by pasting a link above, or use the Readplace iPhone app to save it from the share sheet.",
			label: "Install iPhone app",
			client: "iphone",
		},
	])("invites installing the client for $device when nothing has ever been saved to the default readlist", ({ context, text, label, client }) => {
		const doc = pageDoc(
			{ filters: { ...DEFAULT_FILTERS, readlist: DEFAULT_READLIST_SLUG } },
			{ readlistHoldsArticles: false, onboarding: onboardingWith(context) },
		);

		expect(doc.querySelector(".readlist-empty__title")?.textContent).toBe("Nothing saved yet");
		expect(doc.querySelector(".readlist-empty__text")?.textContent).toBe(text);
		expect(emptyActionKeys(doc)).toEqual(["install"]);
		const install = doc.querySelector('[data-test-empty-action="install"]');
		assert(install, "the install CTA must be offered");
		expect(install.textContent).toBe(label);
		const href = new URL(install.getAttribute("href") ?? "", "https://internal.invalid");
		expect(href.pathname).toBe("/install");
		expect(href.searchParams.get("client")).toBe(client);
		expect(href.searchParams.get("utm_source")).toBe("queue-empty");
		expect(href.searchParams.get("utm_medium")).toBe("internal");
		expect(href.searchParams.get("utm_content")).toBe("install");
	});

	it("offers no install to a reader who already has the extension when nothing has ever been saved", () => {
		const doc = pageDoc(
			{ filters: { ...DEFAULT_FILTERS, readlist: DEFAULT_READLIST_SLUG } },
			{
				readlistHoldsArticles: false,
				onboarding: onboardingWith(installableClient({ platform: "chrome", installed: true })),
			},
		);

		expect(doc.querySelector(".readlist-empty__text")?.textContent).toBe(
			"Save your first article by pasting a link above, or use the Readplace browser extension to save it in one click.",
		);
		expect(emptyActionKeys(doc)).toEqual([]);
	});

	it("tells a reader with an empty custom readlist to add an article from All, with no action", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug } }, { readlistHoldsArticles: false });

		expect(doc.querySelector(".readlist-empty__title")?.textContent).toBe(
			"No articles in this readlist yet",
		);
		expect(doc.querySelector(".readlist-empty__text")?.textContent).toBe(
			"Choose an article from All and add it here to start organising this readlist.",
		);
		expect(emptyActionKeys(doc)).toEqual([]);
	});

	it("offers no action to a reader who is caught up on To Read", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, tab: "queue" } }, { readlistHoldsArticles: true });

		expect(doc.querySelector(".readlist-empty__title")?.textContent).toBe("You're all caught up");
		expect(emptyActionKeys(doc)).toEqual([]);
	});

	it("points a reader at their unread articles when nothing is read yet", () => {
		const doc = pageDoc({ filters: { ...DEFAULT_FILTERS, tab: "done" } }, { readlistHoldsArticles: true });

		expect(doc.querySelector(".readlist-empty__title")?.textContent).toBe("No finished articles yet");
		expect(emptyActionKeys(doc)).toEqual(["view-unread"]);
		const action = doc.querySelector('[data-test-empty-action="view-unread"]');
		assert(action, "the View Unread Articles CTA must be offered");
		expect(urlParams(action.getAttribute("href")).get("utm_content")).toBe("view-unread");
	});

	it("offers no action to a caught-up reader of a custom readlist", () => {
		const doc = pageDoc(
			{ filters: { ...DEFAULT_FILTERS, readlist: WORK.slug, tab: "queue" } },
			{ readlistHoldsArticles: true },
		);

		expect(emptyActionKeys(doc)).toEqual([]);
	});

	it("hides the list header on an empty list", () => {
		const doc = pageDoc({ isEmpty: true });

		const header = doc.querySelector(".readlist-listing__header");
		assert(header, "the list header must always render");
		expect(header.classList.contains("readlist-listing__header--hidden")).toBe(true);
	});

	it("shows the list header on a list that holds articles", () => {
		const doc = pageDoc({ articles: [PLAIN_ARTICLE], isEmpty: false });

		const header = doc.querySelector(".readlist-listing__header");
		assert(header, "the list header must always render");
		expect(header.classList.contains("readlist-listing__header--visible")).toBe(true);
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
		expect(prev.classList.contains("pagination__link--enabled")).toBe(true);
		expect(next.classList.contains("pagination__link--enabled")).toBe(true);
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
		expect(prev.classList.contains("pagination__link--disabled")).toBe(true);
		expect(next.classList.contains("pagination__link--disabled")).toBe(true);
		expect(prev.getAttribute("aria-disabled")).toBe("true");
		expect(next.getAttribute("aria-disabled")).toBe("true");
	});

	it("leads Previous with the left chevron and trails Next with the right chevron", () => {
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
		const leftChevron = new JSDOM(iconSvg("chevron-left")).window.document.querySelector("svg");
		const rightChevron = new JSDOM(iconSvg("chevron-right")).window.document.querySelector("svg");
		assert(leftChevron, "the left chevron must be an svg drawing");
		assert(rightChevron, "the right chevron must be an svg drawing");
		expect(prev.firstElementChild?.tagName.toLowerCase()).toBe("svg");
		expect(prev.firstElementChild?.innerHTML).toBe(leftChevron.innerHTML);
		expect(next.lastElementChild?.tagName.toLowerCase()).toBe("svg");
		expect(next.lastElementChild?.innerHTML).toBe(rightChevron.innerHTML);
	});

	it("names the enabled pagination links by their relation, so a client can follow the next page", () => {
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
		expect(prev.getAttribute("rel")).toBe("prev");
		expect(next.getAttribute("rel")).toBe("next");
	});

	it("offers the unread download beside the sort control", () => {
		const doc = pageDoc({ articles: [PLAIN_ARTICLE], isEmpty: false });

		const control = offlineDownload(doc);
		expect(control.classList.contains("readlist-listing__offline--offered")).toBe(true);
		expect(control.previousElementSibling?.hasAttribute("data-test-sort")).toBe(true);
		const start = control.querySelector("[data-test-offline-download-start]");
		assert(start, "the control must hold its start button");
		expect(start.tagName.toLowerCase()).toBe("button");
		expect(start.getAttribute("type")).toBe("button");
		expect(Array.from(start.classList)).toEqual(["btn", "btn--neutral", "btn--s"]);
		const progress = control.querySelector("[data-test-offline-download-progress]");
		assert(progress, "the control must hold its progress bar");
		expect(progress.tagName.toLowerCase()).toBe("progress");
		const status = control.querySelector("[data-test-offline-download-status]");
		assert(status, "the control must hold its status line");
		expect(status.getAttribute("aria-live")).toBe("polite");
	});

	it("points the unread download at the first page of the unread listing, in its current order and readlist, tracked as its own click", () => {
		const doc = pageDoc({
			articles: [PLAIN_ARTICLE],
			isEmpty: false,
			currentPage: 3,
			filters: { readlist: WORK.slug, tab: "queue", order: "asc", page: 3 },
		});

		const href = offlineDownload(doc).getAttribute("data-offline-download");
		const url = new URL(href ?? "", "https://internal.invalid");
		expect(url.pathname).toBe("/queue");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			queue: WORK.slug,
			order: "asc",
			utm_source: "queue-listing",
			utm_medium: "internal",
			utm_content: "download-offline",
		});
	});

	it("withholds the unread download on the Read tab", () => {
		const doc = pageDoc({ articles: [PLAIN_ARTICLE], isEmpty: false, filters: { ...DEFAULT_FILTERS, tab: "done" } });

		expect(offlineDownload(doc).classList.contains("readlist-listing__offline--withheld")).toBe(true);
	});

	it("withholds the unread download when there is nothing unread to download", () => {
		const doc = pageDoc({ isEmpty: true });

		expect(offlineDownload(doc).classList.contains("readlist-listing__offline--withheld")).toBe(true);
	});

	it("hides the pager on an empty list", () => {
		const doc = pageDoc({ isEmpty: true });

		const pager = doc.querySelector("[data-test-pagination]");
		assert(pager, "the pager must always render");
		expect(pager.classList.contains("pagination--hidden")).toBe(true);
	});

	it("offers the subscribe-plans popover during a trial countdown", () => {
		const doc = pageDoc({
			subscriptionBanner: {
				state: "trial-countdown",
				daysLeft: 2,
				daysLeftWord: "days",
				remaining: { days: 2, hours: 0, minutes: 0, seconds: 0, totalMs: 0 },
				checkedPlan: "yearly",
			},
		});

		expect(doc.querySelectorAll("#subscribe-plans")).toHaveLength(1);
	});

	it("offers the subscribe-plans popover once the subscription has gone inactive", () => {
		const doc = pageDoc({ subscriptionBanner: { state: "inactive", checkedPlan: "yearly" } });

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
		expect(articleConfirm.querySelectorAll('.confirm-popover__illustration [data-test-illustration="trash-can"]')).toHaveLength(1);
		expect(readlistConfirm.querySelectorAll('.confirm-popover__illustration [data-test-illustration="trash-can"]')).toHaveLength(1);
	});

	it("asks where the articles go only for the readlists the rail says hold some", () => {
		const finance: Readlist = { slug: ReadlistSlugSchema.parse("finance"), label: "Finance" };
		const doc = pageDoc(
			{},
			{ rail: { ...RAIL, readlists: [DEFAULT_READLIST, WORK, finance], nonEmptyReadlists: [WORK.slug] } },
		);

		const titles = Array.from(
			doc.querySelectorAll('[data-test-confirm-popover="readlist-delete"]'),
			(panel) => doc.getElementById(`${panel.id}-title`)?.textContent,
		);
		expect(titles).toEqual(["Move or delete articles", "Delete this readlist?"]);
	});

	it("leads the empty readlist with the book and lightbulb", () => {
		const doc = pageDoc();

		const empty = doc.querySelector("[data-test-empty-readlist]");
		assert(empty, "the empty readlist must render");
		expect(empty.querySelectorAll('.readlist-empty__illustration [data-test-illustration="book-lightbulb"]')).toHaveLength(1);
	});

	it("offers a rename popover for each readlist the reader owns", () => {
		const doc = pageDoc();

		const popover = doc.getElementById(readlistRenamePopoverId(WORK.slug));
		assert(popover, "the owned readlist's rename popover must render");
		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-rename"]')).toHaveLength(1);
	});

	it("offers the create dialog the rail's create row opens", () => {
		const doc = pageDoc();

		const popover = doc.querySelector('[data-test-confirm-popover="readlist-create"]');
		assert(popover, "the create dialog must render for a reader who can create");
		expect(popover.getAttribute("id")).toBe("readlist-create");
		expect(popover.closest("main")?.tagName).toBe("MAIN");
	});

	it("withholds every rename, create and readlist-delete popover from a reader who cannot write", () => {
		const doc = pageDoc({}, { rail: { ...RAIL, canCreate: false } });

		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-rename"]')).toHaveLength(0);
		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-create"]')).toHaveLength(0);
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

	it("resubmits a pending save once the page loads, only when a save is actually pending", () => {
		const withUrl = buildPage({}, { saveUrl: "https://example.com/x" });
		const withoutUrl = buildPage();
		assert(withUrl.scripts, "the page must ship its scripts");
		assert(withoutUrl.scripts, "the page must ship its scripts");

		expect(withUrl.scripts.includes("requestSubmit")).toBe(true);
		expect(withoutUrl.scripts.includes("requestSubmit")).toBe(false);
	});

	it("ships the design client script that drives the nav menus and the naming dialogs", () => {
		const body = buildPage();
		assert(body.scripts, "the page must ship its scripts");

		expect(body.scripts.includes(READLIST_CLIENT_SCRIPT)).toBe(true);
	});

	it("ships the client that drives the unread download", () => {
		const body = buildPage();
		assert(body.scripts, "the page must ship its scripts");

		expect(body.scripts.includes(OFFLINE_DOWNLOAD_SCRIPT)).toBe(true);
	});
});
