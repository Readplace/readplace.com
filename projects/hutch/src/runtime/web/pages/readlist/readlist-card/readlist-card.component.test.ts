import assert from "node:assert/strict";
import type { DeviceClass } from "@packages/web-analytics";
import { JSDOM } from "jsdom";
import type { ArticleAction, ReadlistArticleViewModel } from "../readlist.viewmodel";
import {
	type ReadlistCardDisplayModel,
	renderReadlistCard,
	toReadlistCardDisplayModel,
} from "./readlist-card.component";

function makeViewModel(overrides?: Partial<ReadlistArticleViewModel>): ReadlistArticleViewModel {
	return {
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
		readerHref: "/queue/abc123/view",
		isStalePending: false,
		...overrides,
	};
}

function display(
	vm: ReadlistArticleViewModel,
	options: { isFirst: boolean; deviceClass?: DeviceClass },
): ReadlistCardDisplayModel {
	return toReadlistCardDisplayModel(vm, {
		isFirst: options.isFirst,
		deviceClass: options.deviceClass ?? "desktop",
	});
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function urlParams(href: string | null): URLSearchParams {
	return new URL(href ?? "", "https://internal.invalid").searchParams;
}

const MARK_READ_ACTION: ArticleAction = {
	method: "POST",
	url: "/queue/abc123/status?swap=card",
	text: "Mark as read",
	title: "Mark as read",
	testAction: "mark-read",
	fields: [{ name: "status", value: "read" }],
};
const CONFIRMED_MARK_READ_ACTION: ArticleAction = {
	...MARK_READ_ACTION,
	confirmPopoverId: "readlist-mark-status-confirm-abc123",
};
const DELETE_ACTION: ArticleAction = {
	method: "POST",
	url: "/queue/abc123/delete",
	text: "Delete",
	iconName: "x",
	title: "Delete",
	testAction: "delete",
	fields: [],
	confirmPopoverId: "readlist-delete-confirm-abc123",
};
const { confirmPopoverId: _deletePopoverId, ...UNCONFIRMED_DELETE_ACTION } = DELETE_ACTION;

describe("renderReadlistCard", () => {
	it("flags an unread article with the unread modifier", () => {
		const doc = parse(renderReadlistCard(display(makeViewModel({ isUnread: true }), { isFirst: false })));

		const card = doc.querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(card.classList.contains("readlist-article--unread")).toBe(true);
	});

	it("flags a read article with the read modifier", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ status: "read", isUnread: false }), { isFirst: false }),
			),
		);

		const card = doc.querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(card.classList.contains("readlist-article--read")).toBe(true);
		expect(card.classList.contains("readlist-article--unread")).toBe(false);
	});

	it("marks an unread article with a read-status indicator carrying its screen-reader label", () => {
		const doc = parse(renderReadlistCard(display(makeViewModel({ isUnread: true }), { isFirst: false })));

		const status = doc.querySelector("[data-test-read-status]");
		assert(status, "the card must render a read-status indicator");
		expect(status.getAttribute("data-test-read-status")).toBe("unread");
		expect(status.querySelector(".sr-only")?.textContent).toBe("Unread");
		expect(status.parentElement?.classList.contains("readlist-article__facts")).toBe(true);
	});

	it("keeps the read-status indicator out of the meta row that a processing card hides", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=1" }), { isFirst: false }),
			),
		);

		const meta = doc.querySelector(".readlist-article__meta");
		assert(meta, "the meta row must be present");
		expect(meta.classList.contains("readlist-article__meta--hidden")).toBe(true);
		const status = doc.querySelector("[data-test-read-status]");
		assert(status, "a processing card must still show whether it is unread");
		expect(status.closest(".readlist-article__meta")).toBeNull();
	});

	it("leads a processing card's Processing line with its read-status marker in one facts group", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=1" }), { isFirst: false }),
			),
		);

		const status = doc.querySelector("[data-test-read-status]");
		assert(status, "a processing card must still show whether it is unread");
		const processing = doc.querySelector("[data-test-processing]");
		assert(processing, "a processing card must render its Processing line");
		expect(processing.parentElement?.classList.contains("readlist-article__facts")).toBe(true);
		expect(status.nextElementSibling).toBe(processing);
	});

	it("marks a read article with a read-status indicator carrying its screen-reader label", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ status: "read", isUnread: false }), { isFirst: false }),
			),
		);

		const status = doc.querySelector("[data-test-read-status]");
		assert(status, "the card must render a read-status indicator");
		expect(status.getAttribute("data-test-read-status")).toBe("read");
		expect(status.querySelector(".sr-only")?.textContent).toBe("Read");
	});

	it("opens the reader from the thumbnail with its own tracking when the article has an image", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ imageUrl: "https://cdn.example.com/hero.jpg" }), {
					isFirst: false,
					deviceClass: "mobile_ios",
				}),
			),
		);

		const thumbnail = doc.querySelector(".readlist-article__thumbnail-link");
		assert(thumbnail, "the card must render a thumbnail link when it has an image");
		const image = thumbnail.querySelector("img");
		assert(image, "the thumbnail link must wrap the article image");
		expect(image.getAttribute("src")).toBe("https://cdn.example.com/hero.jpg");
		expect(thumbnail.hasAttribute("data-opens-reader")).toBe(true);
		const href = urlParams(thumbnail.getAttribute("href"));
		expect(href.get("utm_content")).toBe("open-article-thumbnail");
		expect(href.get("utm_term")).toBe("mobile_ios");
	});

	it("posts a status change to a card-scoped, design-flagged URL and swaps only the card", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ actions: [MARK_READ_ACTION] }), { isFirst: false })),
		);

		const button = doc.querySelector('[data-test-action="mark-read"]');
		assert(button, "the status control must be present");
		const form = button.closest("form");
		assert(form, "the status control must submit a form");
		const action = urlParams(form.getAttribute("action"));
		expect(action.get("swap")).toBe("card");
		expect(form.getAttribute("hx-target")).toBe("closest .readlist-article");
	});

	it("disables the status action and keeps its loader while the card is still being fetched", () => {
		const doc = parse(
			renderReadlistCard(
				display(
					makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=1", actions: [MARK_READ_ACTION, DELETE_ACTION] }),
					{ isFirst: false },
				),
			),
		);

		const button = doc.querySelector('[data-test-action="mark-read"]');
		assert(button, "the status control must be present");
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.querySelectorAll(".readlist-article__action-btn-loader span").length).toBe(3);
		const deleteButton = doc.querySelector('[data-test-action="delete"]');
		assert(deleteButton, "the delete control must be present");
		expect(deleteButton.hasAttribute("disabled")).toBe(false);
	});

	it("enables the status action once the card reaches a terminal state", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ cardPollUrl: undefined, actions: [MARK_READ_ACTION] }), { isFirst: false }),
			),
		);

		const button = doc.querySelector('[data-test-action="mark-read"]');
		assert(button, "the status control must be present");
		expect(button.hasAttribute("disabled")).toBe(false);
	});

	it("submits an unconfirmed status change straight from the card", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ actions: [MARK_READ_ACTION] }), { isFirst: false })),
		);

		const button = doc.querySelector('[data-test-action="mark-read"]');
		assert(button, "the status control must be present");
		expect(button.getAttribute("type")).toBe("submit");
		expect(doc.querySelectorAll('[data-test-action="mark-read-fallback"]')).toHaveLength(0);
	});

	it("splits a confirmed status change into a popover trigger and a hidden fallback form", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ actions: [CONFIRMED_MARK_READ_ACTION] }), { isFirst: false }),
			),
		);

		const trigger = doc.querySelector('[data-test-action="mark-read"]');
		const fallback = doc.querySelector('[data-test-action="mark-read-fallback"]');
		assert(trigger, "the trigger must take the status action's own test hook");
		assert(fallback, "the plain form must stay behind as the no-popover fallback");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-mark-status-confirm-abc123");
		expect(trigger.parentElement?.classList.contains("readlist-article__foot")).toBe(true);
		expect(fallback.getAttribute("type")).toBe("submit");
		const fallbackForm = fallback.closest("form");
		assert(fallbackForm, "the fallback must submit through a form");
		expect(fallbackForm.classList.contains("readlist-article__fallback")).toBe(true);
	});

	it("deletes straight from the ••• menu once the reader has silenced the confirmation", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ actions: [UNCONFIRMED_DELETE_ACTION] }), { isFirst: false }),
			),
		);

		const control = doc.querySelector('[data-test-action="delete"]');
		assert(control, "the delete control must be present");
		expect(control.getAttribute("type")).toBe("submit");
		expect(doc.querySelectorAll('[data-test-action="delete-fallback"]')).toHaveLength(0);
	});

	it("opens a confirmation from the ••• menu and keeps a hidden plain-post fallback behind it", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ actions: [DELETE_ACTION] }), { isFirst: false })),
		);

		const trigger = doc.querySelector('[data-test-action="delete"]');
		assert(trigger, "the delete trigger must be present");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-delete-confirm-abc123");
		expect(trigger.parentElement?.classList.contains("readlist-article__menu-panel")).toBe(true);

		const fallback = doc.querySelector('[data-test-action="delete-fallback"]');
		assert(fallback, "a no-popover delete fallback must be present");
		expect(fallback.getAttribute("type")).toBe("submit");
		const fallbackForm = fallback.closest("form");
		assert(fallbackForm, "the fallback must submit through a form");
		expect(fallbackForm.classList.contains("readlist-article__fallback")).toBe(true);
	});

	it("re-polls itself at the URL the view model gave it", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=2" }), { isFirst: false }),
			),
		);

		const card = doc.querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(card.getAttribute("hx-get")).toBe("/queue/abc123/card?poll=2");
	});

	it("carries no poll URL once the card has reached a terminal state", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ cardPollUrl: undefined }), { isFirst: false })),
		);

		const card = doc.querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(card.hasAttribute("hx-get")).toBe(false);
	});

	it("hides the meta row and shows the processing state while the card is still being fetched", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=1" }), { isFirst: false }),
			),
		);

		const meta = doc.querySelector(".readlist-article__meta");
		const processing = doc.querySelector("[data-test-processing]");
		assert(meta, "the meta row must be present");
		assert(processing, "the processing indicator must be present");
		expect(meta.classList.contains("readlist-article__meta--hidden")).toBe(true);
		expect(processing.classList.contains("readlist-article__processing--hidden")).toBe(false);
	});

	it("shows the meta row and hides the processing state once the card is terminal", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ cardPollUrl: undefined }), { isFirst: false })),
		);

		const meta = doc.querySelector(".readlist-article__meta");
		const processing = doc.querySelector("[data-test-processing]");
		assert(meta, "the meta row must be present");
		assert(processing, "the processing indicator must be present");
		expect(meta.classList.contains("readlist-article__meta--hidden")).toBe(false);
		expect(processing.classList.contains("readlist-article__processing--hidden")).toBe(true);
	});

	it("shows the stale-pending hint when the card gave up on the crawl", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ isStalePending: true }), { isFirst: false })),
		);

		const hint = doc.querySelector("[data-test-stale-pending]");
		assert(hint, "the stale-pending hint must be rendered");
		const link = hint.querySelector("a");
		assert(link, "the hint must link to the source URL");
		expect(link.getAttribute("href")).toBe("https://example.com/article");
	});

	it("omits the stale-pending hint on the normal flow", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ isStalePending: false }), { isFirst: false })),
		);

		expect(doc.querySelectorAll("[data-test-stale-pending]")).toHaveLength(0);
	});

	it("marks the site link empty when siteName is blank", () => {
		const doc = parse(renderReadlistCard(display(makeViewModel({ siteName: "" }), { isFirst: false })));

		const link = doc.querySelector("[data-test-article-url]");
		assert(link, "the site link must always be rendered");
		expect(link.classList.contains("readlist-article__site--empty")).toBe(true);
	});

	it("keeps the site link filled when siteName is present", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ siteName: "example.com" }), { isFirst: false })),
		);

		const link = doc.querySelector("[data-test-article-url]");
		assert(link, "the site link must always be rendered");
		expect(link.classList.contains("readlist-article__site--empty")).toBe(false);
	});

	it("carries the full site name in the link title so a truncated name stays readable", () => {
		const fullName = "Andi Roberts - Executive Coach | Leadership Trainer | Facilitator";
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ siteName: fullName }), { isFirst: false })),
		);

		const link = doc.querySelector("[data-test-article-url]");
		assert(link, "the site link must always be rendered");
		expect(link.getAttribute("title")).toBe(fullName);
		const name = link.querySelector(".readlist-article__site-name");
		assert(name, "the site name span must be rendered");
		expect(name.textContent).toBe(fullName);
	});

	it("marks the read time empty when the crawl has not landed", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ readTime: undefined }), { isFirst: false })),
		);

		const readTime = doc.querySelector("[data-test-read-time]");
		assert(readTime, "the read-time part must always be rendered");
		expect(readTime.textContent).toBe("");
		expect(readTime.classList.contains("readlist-article__read-time--empty")).toBe(true);
	});

	it("shows the crawler's read time once it has landed", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ readTime: { value: "3", label: "~3 min read" } }), { isFirst: false }),
			),
		);

		const readTime = doc.querySelector("[data-test-read-time]");
		assert(readTime, "the read-time part must always be rendered");
		expect(readTime.textContent).toBe("~3 min read");
		expect(readTime.classList.contains("readlist-article__read-time--empty")).toBe(false);
	});

	it("clamps a crawler-parsed excerpt, which is unbounded page prose rather than a teaser", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ excerptSource: "parsed" }), { isFirst: false })),
		);

		const excerpt = doc.querySelector("[data-test-article-excerpt]");
		assert(excerpt, "the excerpt must be rendered");
		expect(excerpt.classList.contains("readlist-article__excerpt--clamped")).toBe(true);
	});

	it("never clamps a generated excerpt, which the model wrote to be read whole", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ excerptSource: "generated" }), { isFirst: false })),
		);

		const excerpt = doc.querySelector("[data-test-article-excerpt]");
		assert(excerpt, "the excerpt must be rendered");
		expect(excerpt.classList.contains("readlist-article__excerpt--clamped")).toBe(false);
	});

	it("tracks the title and excerpt links with the device class as utm_term", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel(), { isFirst: false, deviceClass: "mobile_ios" })),
		);

		const title = doc.querySelector("[data-test-article-title]");
		const excerpt = doc.querySelector("[data-test-article-excerpt]");
		assert(title, "the title link must be rendered");
		assert(excerpt, "the excerpt link must be rendered");
		const titleParams = urlParams(title.getAttribute("href"));
		const excerptParams = urlParams(excerpt.getAttribute("href"));
		expect(titleParams.get("utm_content")).toBe("open-article-title");
		expect(titleParams.get("utm_term")).toBe("mobile_ios");
		expect(excerptParams.get("utm_content")).toBe("open-article-excerpt");
		expect(excerptParams.get("utm_term")).toBe("mobile_ios");
	});
});
