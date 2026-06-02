import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	renderQueueCard,
	toQueueCardDisplayModel,
} from "./queue-card.component";
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
		readTimeLabel: "3 min read",
		status: "unread",
		isUnread: true,
		savedAgo: "10m ago",
		hasContent: false,
		actions: [],
		isStalePending: false,
		...overrides,
	};
}

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("renderQueueCard", () => {
	it("renders the article title and excerpt", () => {
		const html = renderQueueCard(
			toQueueCardDisplayModel(makeViewModel(), { isFirst: false }),
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

	it("emits the polling htmx attributes when cardPollUrl is set", () => {
		const html = renderQueueCard(
			toQueueCardDisplayModel(
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
			toQueueCardDisplayModel(makeViewModel({ cardPollUrl: undefined }), {
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
			toQueueCardDisplayModel(makeViewModel(), { isFirst: true }),
		);
		const card = parse(html).querySelector(".queue-article");
		assert(card);
		expect(card.getAttribute("id")).toBe("latest-saved");
	});

	it("does not mark non-first cards with id=latest-saved", () => {
		const html = renderQueueCard(
			toQueueCardDisplayModel(makeViewModel(), { isFirst: false }),
		);
		const card = parse(html).querySelector(".queue-article");
		assert(card);
		expect(card.hasAttribute("id")).toBe(false);
	});

	it("renders the 'Taking a while — open on source' hint when isStalePending is true", () => {
		const html = renderQueueCard(
			toQueueCardDisplayModel(makeViewModel({ isStalePending: true }), {
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
			toQueueCardDisplayModel(makeViewModel({ isStalePending: false }), {
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
			toQueueCardDisplayModel(makeViewModel({ actions: [MARK_READ_ACTION] }), {
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

	it("shows a processing state and disables the status action while the card is still being fetched", () => {
		const html = renderQueueCard(
			toQueueCardDisplayModel(
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
		expect(doc.querySelector("[data-test-action='mark-read']")?.hasAttribute("disabled")).toBe(true);
		expect(doc.querySelector("[data-test-action='delete']")?.hasAttribute("disabled")).toBe(false);
	});

	it("enables the status action and omits the processing state once the card is terminal", () => {
		const html = renderQueueCard(
			toQueueCardDisplayModel(
				makeViewModel({
					cardPollUrl: undefined,
					actions: [MARK_READ_ACTION, DELETE_ACTION],
				}),
				{ isFirst: false },
			),
		);
		const doc = parse(html);
		assert.equal(doc.querySelector("[data-test-processing]"), null);
		expect(doc.querySelector("[data-test-action='mark-read']")?.hasAttribute("disabled")).toBe(false);
	});
});
