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
});
