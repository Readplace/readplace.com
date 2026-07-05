import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	type QueueCardDisplayModel,
	renderQueueCard,
	toQueueCardDisplayModel,
} from "./queue-card.component";
import type { DeviceClass } from "@packages/web-analytics";
import type { QueueArticleViewModel } from "../queue.viewmodel";

function makeViewModel(
	overrides?: Partial<QueueArticleViewModel>,
): QueueArticleViewModel {
	return {
		id: "abc123",
		title: "Article Title",
		siteName: "example.com",
		excerpt: "An excerpt.",
		url: "https://example.com/article",
		status: "unread",
		isUnread: true,
		saved: { iso: "2025-06-01T12:50:00.000Z", label: "10m ago", mode: "relative" },
		hasContent: false,
		actions: [],
		isStalePending: false,
		...overrides,
	};
}

function display(
	vm: QueueArticleViewModel,
	options: { isFirst: boolean; deviceClass?: DeviceClass },
): QueueCardDisplayModel {
	return toQueueCardDisplayModel(vm, {
		isFirst: options.isFirst,
		deviceClass: options.deviceClass ?? "desktop",
	});
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function readerLinkParams(el: Element | null): {
	path: string;
	content: string | null;
	term: string | null;
} {
	assert(el, "reader-view link must be present");
	const url = new URL(el.getAttribute("href") ?? "", "https://internal.invalid");
	return {
		path: url.pathname,
		content: url.searchParams.get("utm_content"),
		term: url.searchParams.get("utm_term"),
	};
}

describe("renderQueueCard", () => {
	it("renders the article title and excerpt", () => {
		const html = renderQueueCard(
			display(makeViewModel(), { isFirst: false }),
		);
		const doc = parse(html);
		const card = doc.querySelector(".queue-article");
		assert(card, "card root must be present");
		expect(doc.querySelector("[data-test-article-title]")?.textContent).toBe(
			"Article Title",
		);
		expect(doc.querySelector(".queue-article__excerpt")?.textContent).toBe(
			"An excerpt.",
		);
	});

	it("points the title, excerpt, and thumbnail at the reader view with a distinct utm_content each and the device class as utm_term", () => {
		const html = renderQueueCard(
			display(makeViewModel({ imageUrl: "https://img.example/x.png" }), {
				isFirst: false,
				deviceClass: "mobile_ios",
			}),
		);
		const doc = parse(html);
		const title = readerLinkParams(doc.querySelector("[data-test-article-title]"));
		const excerpt = readerLinkParams(doc.querySelector("[data-test-article-excerpt]"));
		const thumbnail = readerLinkParams(
			doc.querySelector(".queue-article__thumbnail")?.closest("a") ?? null,
		);
		expect([title.path, excerpt.path, thumbnail.path]).toEqual([
			"/queue/abc123/view",
			"/queue/abc123/view",
			"/queue/abc123/view",
		]);
		expect([title.content, excerpt.content, thumbnail.content]).toEqual([
			"open-article-title",
			"open-article-excerpt",
			"open-article-thumbnail",
		]);
		expect([title.term, excerpt.term, thumbnail.term]).toEqual([
			"mobile_ios",
			"mobile_ios",
			"mobile_ios",
		]);
	});

	it("omits the excerpt link entirely when the excerpt is empty so no empty-name link is rendered", () => {
		const html = renderQueueCard(
			display(makeViewModel({ excerpt: "", imageUrl: "https://img.example/x.png" }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const readerContents = Array.from(
			doc.querySelectorAll("a[href*='/view']"),
		).map((a) => readerLinkParams(a).content);
		expect(readerContents).toEqual([
			"open-article-title",
			"open-article-thumbnail",
		]);
	});

	it("flags unread articles with a read-status chip and the unread modifier", () => {
		const html = renderQueueCard(
			display(makeViewModel({ status: "unread", isUnread: true }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const card = doc.querySelector(".queue-article");
		assert(card, "card root must be present");
		expect(card.classList.contains("queue-article--unread")).toBe(true);
		const status = doc.querySelector("[data-test-read-status]");
		expect(status?.getAttribute("data-test-read-status")).toBe("unread");
		expect(status?.textContent).toBe("Unread");
	});

	it("flags read articles with a read-status chip and the read modifier", () => {
		const html = renderQueueCard(
			display(makeViewModel({ status: "read", isUnread: false }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const card = doc.querySelector(".queue-article");
		assert(card, "card root must be present");
		expect(card.classList.contains("queue-article--read")).toBe(true);
		expect(card.classList.contains("queue-article--unread")).toBe(false);
		const status = doc.querySelector("[data-test-read-status]");
		expect(status?.getAttribute("data-test-read-status")).toBe("read");
		expect(status?.textContent).toBe("Read");
	});

	it("renders the site name as a visible link to the original URL when siteName is present", () => {
		const html = renderQueueCard(
			display(makeViewModel({ siteName: "Example Blog" }), {
				isFirst: false,
			}),
		);
		const link = parse(html).querySelector("[data-test-article-url]");
		assert(link, "the url link must always be rendered");
		expect(link.classList.contains("queue-article__url--empty")).toBe(false);
		expect(link.textContent).toBe("Example Blog");
		expect(link.getAttribute("href")).toBe("https://example.com/article");
	});

	it("renders the URL link in its empty state when siteName is blank", () => {
		const html = renderQueueCard(
			display(makeViewModel({ siteName: "" }), {
				isFirst: false,
			}),
		);
		const link = parse(html).querySelector("[data-test-article-url]");
		assert(link, "the url link must always be rendered even when siteName is blank");
		expect(link.classList.contains("queue-article__url--empty")).toBe(true);
	});

	it("emits the polling htmx attributes when cardPollUrl is set", () => {
		const html = renderQueueCard(
			display(
				makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=2" }),
				{ isFirst: false },
			),
		);
		const card = parse(html).querySelector(".queue-article");
		assert(card, "card root must be present");
		expect(card.getAttribute("hx-get")).toBe("/queue/abc123/card?poll=2");
		expect(card.getAttribute("hx-trigger")).toBe("every 3s");
		expect(card.getAttribute("hx-target")).toBe("this");
		expect(card.getAttribute("hx-swap")).toBe("outerHTML");
		expect(card.getAttribute("data-card-status")).toBe("pending");
	});

	it("does not emit polling attributes when cardPollUrl is undefined", () => {
		const html = renderQueueCard(
			display(makeViewModel({ cardPollUrl: undefined }), {
				isFirst: false,
			}),
		);
		const card = parse(html).querySelector(".queue-article");
		assert(card, "card root must be present");
		expect(card.hasAttribute("hx-get")).toBe(false);
		expect(card.hasAttribute("hx-trigger")).toBe(false);
		expect(card.getAttribute("data-card-status")).toBe("terminal");
	});

	it("marks the first card with id=latest-saved so anchor jumps still work", () => {
		const html = renderQueueCard(
			display(makeViewModel(), { isFirst: true }),
		);
		const card = parse(html).querySelector(".queue-article");
		assert(card);
		expect(card.getAttribute("id")).toBe("latest-saved");
	});

	it("does not mark non-first cards with id=latest-saved", () => {
		const html = renderQueueCard(
			display(makeViewModel(), { isFirst: false }),
		);
		const card = parse(html).querySelector(".queue-article");
		assert(card);
		expect(card.hasAttribute("id")).toBe(false);
	});

	it("renders the 'Taking a while — open on source' hint when isStalePending is true", () => {
		const html = renderQueueCard(
			display(makeViewModel({ isStalePending: true }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const hint = doc.querySelector("[data-test-stale-pending]");
		assert(hint, "stale-pending hint must be rendered when isStalePending is true");
		assert.match(hint.textContent ?? "", /Taking a while/);
		const link = hint.querySelector("a");
		assert(link, "hint must contain a link to the source URL");
		assert.equal(link.getAttribute("href"), "https://example.com/article");
		assert.equal(link.getAttribute("target"), "_blank");
		assert.equal(link.getAttribute("rel"), "noopener");
	});

	it("omits the stale-pending hint when isStalePending is false (normal flow)", () => {
		const html = renderQueueCard(
			display(makeViewModel({ isStalePending: false }), {
				isFirst: false,
			}),
		);
		const hint = parse(html).querySelector("[data-test-stale-pending]");
		assert.equal(hint, null);
	});

	const MARK_READ_ACTION = {
		method: "POST",
		url: "/queue/abc123/status",
		text: "Mark as read",
		title: "Mark as read",
		testAction: "mark-read",
		fields: [{ name: "status", value: "read" }],
	};
	const DELETE_ACTION = {
		method: "POST",
		url: "/queue/abc123/delete",
		text: "×",
		title: "Delete",
		testAction: "delete",
		fields: [],
	};

	it("styles the mark-read control as a primary status button", () => {
		const html = renderQueueCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION] }), {
				isFirst: false,
			}),
		);
		const button = parse(html).querySelector("[data-test-action='mark-read']");
		assert(button, "mark-read button must be present");
		assert(
			button.classList.contains("queue-article__action-btn--status"),
			"mark-read button must use the primary status affordance",
		);
	});

	it("gives the status toggle the reader's in-flight loader affordance and disables it during the request", () => {
		const html = renderQueueCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION, DELETE_ACTION] }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const button = doc.querySelector("[data-test-action='mark-read']");
		assert(button, "mark-read button must be present");

		const label = button.querySelector(".queue-article__action-btn-label");
		assert(label, "status button must wrap its text in a label span");
		expect(label.textContent).toBe("Mark as read");
		// The label carries the whole visible text so textContent stays stable for
		// the listing route assertion; the dots are empty, styled spans.
		expect(button.textContent).toBe("Mark as read");

		const loaderDots = button.querySelectorAll(".queue-article__action-btn-loader span");
		expect(loaderDots.length).toBe(3);

		const statusForm = button.closest("form");
		assert(statusForm, "status button must live in a form");
		expect(statusForm.getAttribute("hx-disabled-elt")).toBe("find button");
	});

	it("leaves the delete control as a bare icon with no loader or request-disable", () => {
		const html = renderQueueCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION, DELETE_ACTION] }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const deleteButton = doc.querySelector("[data-test-action='delete']");
		assert(deleteButton, "delete button must be present");
		expect(deleteButton.textContent).toBe("×");
		// The with-loader shape wraps its text in label + loader spans and its
		// form carries hx-disabled-elt — both gated on affordance === "with-loader".
		// Zero element children is the positive proof the delete control ("bare")
		// opted out; a selector typo can't make it pass for the wrong reason.
		expect(deleteButton.children.length).toBe(0);
	});

	it("shows a processing state and disables the status action while the card is still being fetched", () => {
		const html = renderQueueCard(
			display(
				makeViewModel({
					cardPollUrl: "/queue/abc123/card?poll=1",
					actions: [MARK_READ_ACTION, DELETE_ACTION],
				}),
				{ isFirst: false },
			),
		);
		const doc = parse(html);
		const processing = doc.querySelector("[data-test-processing]");
		assert(processing, "processing indicator must be rendered while polling");
		assert.match(processing.textContent ?? "", /Processing/);
		assert(
			!processing.classList.contains("queue-article__processing--hidden"),
			"processing indicator must be visible while polling",
		);
		expect(doc.querySelector("[data-test-action='mark-read']")?.hasAttribute("disabled")).toBe(true);
		expect(doc.querySelector("[data-test-action='delete']")?.hasAttribute("disabled")).toBe(false);
	});

	it("hides the processing state and enables the status action once the card is terminal", () => {
		const html = renderQueueCard(
			display(
				makeViewModel({
					cardPollUrl: undefined,
					actions: [MARK_READ_ACTION, DELETE_ACTION],
				}),
				{ isFirst: false },
			),
		);
		const doc = parse(html);
		const processing = doc.querySelector("[data-test-processing]");
		assert(processing, "processing indicator must always be rendered");
		assert(
			processing.classList.contains("queue-article__processing--hidden"),
			"processing indicator must be hidden when card is terminal",
		);
		expect(doc.querySelector("[data-test-action='mark-read']")?.hasAttribute("disabled")).toBe(false);
	});
});
