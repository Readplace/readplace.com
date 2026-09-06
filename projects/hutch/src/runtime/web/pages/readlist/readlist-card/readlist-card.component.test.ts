import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	type ReadlistCardDisplayModel,
	renderReadlistCard,
	toReadlistCardDisplayModel,
} from "./readlist-card.component";
import type { DeviceClass } from "@packages/web-analytics";
import type { ReadlistArticleViewModel } from "../readlist.viewmodel";

function makeViewModel(
	overrides?: Partial<ReadlistArticleViewModel>,
): ReadlistArticleViewModel {
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

const META_SEP_CLASS = "readlist-article__meta-part--sep";

function separatedMetaParts(doc: Document): string[] {
	const parts: ReadonlyArray<readonly [string, Element | null]> = [
		["site", doc.querySelector("[data-test-article-url]")],
		["read-time", doc.querySelector("[data-test-read-time]")],
		["saved", doc.querySelector("time[data-local-time]")],
	];
	const separated: string[] = [];
	for (const [name, part] of parts) {
		assert(part, `the ${name} meta part must always be rendered`);
		if (part.classList.contains(META_SEP_CLASS)) {
			separated.push(name);
		}
	}
	return separated;
}

describe("renderReadlistCard", () => {
	it("renders the article title and excerpt", () => {
		const html = renderReadlistCard(
			display(makeViewModel(), { isFirst: false }),
		);
		const doc = parse(html);
		const card = doc.querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(doc.querySelector("[data-test-article-title]")?.textContent).toBe(
			"Article Title",
		);
		expect(doc.querySelector(".readlist-article__excerpt")?.textContent).toBe(
			"An excerpt.",
		);
	});

	it("never clamps a generated excerpt, which the model wrote to be read whole", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ excerptSource: "generated" }), { isFirst: false }),
			),
		);
		expect(
			doc.querySelector("[data-test-article-excerpt]")?.classList.contains(
				"readlist-article__excerpt--clamped",
			),
		).toBe(false);
	});

	it("clamps a crawler-parsed excerpt, which is unbounded page prose rather than a teaser", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ excerptSource: "parsed" }), { isFirst: false }),
			),
		);
		expect(
			doc.querySelector("[data-test-article-excerpt]")?.classList.contains(
				"readlist-article__excerpt--clamped",
			),
		).toBe(true);
	});

	it("points the title, excerpt, and thumbnail at the reader view with a distinct utm_content each and the device class as utm_term", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ imageUrl: "https://img.example/x.png" }), {
				isFirst: false,
				deviceClass: "mobile_ios",
			}),
		);
		const doc = parse(html);
		const title = readerLinkParams(doc.querySelector("[data-test-article-title]"));
		const excerpt = readerLinkParams(doc.querySelector("[data-test-article-excerpt]"));
		const thumbnail = readerLinkParams(
			doc.querySelector(".readlist-article__thumbnail")?.closest("a") ?? null,
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

	it("boosts the title, excerpt and thumbnail links into main and marks them as reader openers", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ imageUrl: "https://img.example/x.png" }), { isFirst: false }),
			),
		);
		const openers = [
			doc.querySelector("[data-test-article-title]"),
			doc.querySelector("[data-test-article-excerpt]"),
			doc.querySelector(".readlist-article__thumbnail-link"),
		];
		for (const opener of openers) {
			assert(opener, "each reader-opening anchor must be present");
			expect(opener.getAttribute("hx-boost")).toBe("true");
			expect(opener.getAttribute("hx-push-url")).toBe("true");
			expect(opener.getAttribute("hx-target")).toBe("main");
			expect(opener.getAttribute("hx-select")).toBe("main");
			expect(opener.getAttribute("hx-swap")).toBe("outerHTML show:none");
			expect(opener.hasAttribute("data-opens-reader")).toBe(true);
		}
	});

	it("keeps the reader links targeting main while the card polls its own root", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=2" }), { isFirst: false }),
			),
		);
		expect(doc.querySelector(".readlist-article")?.getAttribute("hx-target")).toBe("this");
		expect(doc.querySelector("[data-test-article-title]")?.getAttribute("hx-target")).toBe("main");
	});

	it("names the fields the reader skeleton copies from the card, and points the site field at the original URL", () => {
		const doc = parse(renderReadlistCard(display(makeViewModel(), { isFirst: false })));
		const fields = Array.from(doc.querySelectorAll("[data-reader-field]")).map((el) =>
			el.getAttribute("data-reader-field"),
		);
		expect(fields).toEqual(["site", "read-time", "title"]);
		expect(doc.querySelector('[data-reader-field="site"]')?.getAttribute("href")).toBe(
			"https://example.com/article",
		);
	});

	it("omits the excerpt link entirely when the excerpt is empty so no empty-name link is rendered", () => {
		const html = renderReadlistCard(
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
		const html = renderReadlistCard(
			display(makeViewModel({ status: "unread", isUnread: true }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const card = doc.querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(card.classList.contains("readlist-article--unread")).toBe(true);
		const status = doc.querySelector("[data-test-read-status]");
		expect(status?.getAttribute("data-test-read-status")).toBe("unread");
		expect(status?.textContent).toBe("Unread");
	});

	it("flags read articles with a read-status chip and the read modifier", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ status: "read", isUnread: false }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const card = doc.querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(card.classList.contains("readlist-article--read")).toBe(true);
		expect(card.classList.contains("readlist-article--unread")).toBe(false);
		const status = doc.querySelector("[data-test-read-status]");
		expect(status?.getAttribute("data-test-read-status")).toBe("read");
		expect(status?.textContent).toBe("Read");
	});

	it("renders the site name as a visible link to the original URL when siteName is present", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ siteName: "Example Blog" }), {
				isFirst: false,
			}),
		);
		const link = parse(html).querySelector("[data-test-article-url]");
		assert(link, "the url link must always be rendered");
		expect(link.classList.contains("readlist-article__url--empty")).toBe(false);
		expect(link.textContent).toBe("Example Blog");
		expect(link.getAttribute("href")).toBe("https://example.com/article");
	});

	it("renders the URL link in its empty state when siteName is blank", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ siteName: "" }), {
				isFirst: false,
			}),
		);
		const link = parse(html).querySelector("[data-test-article-url]");
		assert(link, "the url link must always be rendered even when siteName is blank");
		expect(link.classList.contains("readlist-article__url--empty")).toBe(true);
	});

	it("renders the server's read-time label verbatim for a crawled article", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ readTime: { value: "3", label: "~3 min read" } }), {
				isFirst: false,
			}),
		);
		const readTime = parse(html).querySelector("[data-test-read-time]");
		assert(readTime, "the read-time part must always be rendered");
		expect(readTime.textContent).toBe("~3 min read");
		expect(readTime.classList.contains("readlist-article__read-time--empty")).toBe(false);
	});

	it("renders the read-time part in its empty state when the article's crawl has not landed", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ readTime: undefined }), { isFirst: false }),
		);
		const readTime = parse(html).querySelector("[data-test-read-time]");
		assert(
			readTime,
			"the read-time part must be rendered even when the crawl has not landed",
		);
		expect(readTime.textContent).toBe("");
		expect(readTime.classList.contains("readlist-article__read-time--empty")).toBe(true);
	});

	it("separates read time and saved time when the site name leads the meta row", () => {
		const html = renderReadlistCard(
			display(
				makeViewModel({
					siteName: "Example Blog",
					readTime: { value: "3", label: "~3 min read" },
				}),
				{ isFirst: false },
			),
		);
		expect(separatedMetaParts(parse(html))).toEqual(["read-time", "saved"]);
	});

	it("leaves the read time unseparated when a blank site name makes it the first present part", () => {
		const html = renderReadlistCard(
			display(
				makeViewModel({
					siteName: "",
					readTime: { value: "3", label: "~3 min read" },
				}),
				{ isFirst: false },
			),
		);
		expect(separatedMetaParts(parse(html))).toEqual(["saved"]);
	});

	it("separates only the saved time when the article has no read time to show", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ siteName: "Example Blog", readTime: undefined }), {
				isFirst: false,
			}),
		);
		expect(separatedMetaParts(parse(html))).toEqual(["saved"]);
	});

	it("orders the meta row site, then read time, then saved time — the order mobile reads", () => {
		const doc = parse(renderReadlistCard(display(makeViewModel(), { isFirst: false })));
		const meta = doc.querySelector(".readlist-article__meta");
		assert(meta, "the meta row must be present");
		const order = Array.from(meta.children).map((part) => {
			const blockClass = part.classList.item(0);
			assert(blockClass, "every meta part must carry a block class");
			return blockClass;
		});
		expect(order).toEqual([
			"readlist-article__status",
			"readlist-article__url",
			"readlist-article__read-time",
			"readlist-article__time",
		]);
	});

	it("emits the polling htmx attributes when cardPollUrl is set", () => {
		const html = renderReadlistCard(
			display(
				makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=2" }),
				{ isFirst: false },
			),
		);
		const card = parse(html).querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(card.getAttribute("hx-get")).toBe("/queue/abc123/card?poll=2");
		expect(card.getAttribute("hx-trigger")).toBe("every 3s");
		expect(card.getAttribute("hx-target")).toBe("this");
		expect(card.getAttribute("hx-swap")).toBe("outerHTML");
		expect(card.getAttribute("data-card-status")).toBe("pending");
	});

	it("does not emit polling attributes when cardPollUrl is undefined", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ cardPollUrl: undefined }), {
				isFirst: false,
			}),
		);
		const card = parse(html).querySelector(".readlist-article");
		assert(card, "card root must be present");
		expect(card.hasAttribute("hx-get")).toBe(false);
		expect(card.hasAttribute("hx-trigger")).toBe(false);
		expect(card.getAttribute("data-card-status")).toBe("terminal");
	});

	it("marks the first card with id=latest-saved so anchor jumps still work", () => {
		const html = renderReadlistCard(
			display(makeViewModel(), { isFirst: true }),
		);
		const card = parse(html).querySelector(".readlist-article");
		assert(card);
		expect(card.getAttribute("id")).toBe("latest-saved");
	});

	it("does not mark non-first cards with id=latest-saved", () => {
		const html = renderReadlistCard(
			display(makeViewModel(), { isFirst: false }),
		);
		const card = parse(html).querySelector(".readlist-article");
		assert(card);
		expect(card.hasAttribute("id")).toBe(false);
	});

	it("renders the 'Taking a while — open on source' hint when isStalePending is true", () => {
		const html = renderReadlistCard(
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
		const html = renderReadlistCard(
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
		text: "Delete",
		iconName: "x" as const,
		title: "Delete",
		testAction: "delete",
		fields: [],
		confirmPopoverId: "readlist-delete-confirm-abc123",
	};
	const { confirmPopoverId: _popoverId, ...UNCONFIRMED_DELETE_ACTION } = DELETE_ACTION;

	it("styles the mark-read control as a primary status button", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION] }), {
				isFirst: false,
			}),
		);
		const button = parse(html).querySelector("[data-test-action='mark-read']");
		assert(button, "mark-read button must be present");
		assert(
			button.classList.contains("readlist-article__action-btn--status"),
			"mark-read button must use the primary status affordance",
		);
	});

	it("gives the status toggle the reader's in-flight loader affordance and disables it during the request", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION, DELETE_ACTION] }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const button = doc.querySelector("[data-test-action='mark-read']");
		assert(button, "mark-read button must be present");

		const label = button.querySelector(".readlist-article__action-btn-label");
		assert(label, "status button must wrap its text in a label span");
		expect(label.textContent).toBe("Mark as read");
		// The label carries the whole visible text so textContent stays stable for
		// the listing route assertion; the dots are empty, styled spans.
		expect(button.textContent).toBe("Mark as read");

		const loaderDots = button.querySelectorAll(".readlist-article__action-btn-loader span");
		expect(loaderDots.length).toBe(3);

		const statusForm = button.closest("form");
		assert(statusForm, "status button must live in a form");
		expect(statusForm.getAttribute("hx-disabled-elt")).toBe("find button");
	});

	it("opens the confirmation instead of submitting the delete", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION, DELETE_ACTION] }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const trigger = doc.querySelector("[data-test-action='delete']");
		assert(trigger, "delete trigger must be present");
		expect(trigger.textContent).toBe("Delete");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-delete-confirm-abc123");
		// A submit button inside a form submits and returns before the popover
		// step runs, so re-parenting the trigger into a form would delete on the
		// first click and the confirmation would silently cease to exist.
		expect(trigger.closest("form")).toBeNull();
		// The loader spans are gated on affordance === "with-loader"; their absence
		// is the positive proof the delete control ("bare") opted out.
		expect(trigger.querySelectorAll(".readlist-article__action-btn-loader").length).toBe(0);
	});

	it("renders exactly one delete trigger per card", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION, DELETE_ACTION] }), {
				isFirst: false,
			}),
		);
		expect(parse(html).querySelectorAll("[data-test-action='delete']").length).toBe(1);
	});

	it("deletes straight from the card once the reader has silenced the confirmation", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION, UNCONFIRMED_DELETE_ACTION] }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const control = doc.querySelector("[data-test-action='delete']");
		assert(control, "the delete control must still be present");

		expect(control.getAttribute("type")).toBe("submit");
		expect(control.closest("form")?.classList.contains("readlist-article__delete-fallback")).toBe(
			false,
		);
		expect(doc.querySelectorAll("[data-test-action='delete-fallback']").length).toBe(0);
	});

	it("keeps a straight-through delete form for browsers without popover support", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION, DELETE_ACTION] }), {
				isFirst: false,
			}),
		);
		const fallback = parse(html).querySelector("[data-test-action='delete-fallback']");
		assert(fallback, "no-popover fallback must be present");
		expect(fallback.getAttribute("type")).toBe("submit");

		const fallbackForm = fallback.closest("form");
		assert(fallbackForm, "the fallback must submit a real form");
		expect(fallbackForm.classList.contains("readlist-article__delete-fallback")).toBe(true);
		expect(fallbackForm.getAttribute("method")).toBe("POST");
		assert.match(fallbackForm.getAttribute("action") ?? "", /^\/queue\/abc123\/delete\?/);
		assert.match(fallbackForm.getAttribute("action") ?? "", /utm_content=delete(&|$)/);
	});

	it("leaves the status form alone, and unrenamed, when nothing needs confirming", () => {
		const html = renderReadlistCard(
			display(makeViewModel({ actions: [MARK_READ_ACTION, DELETE_ACTION] }), {
				isFirst: false,
			}),
		);
		const doc = parse(html);
		const button = doc.querySelector("[data-test-action='mark-read']");

		assert(button, "the plain status button must be present");
		expect(button.getAttribute("type")).toBe("submit");
		expect(doc.querySelectorAll(".readlist-article__status-fallback")).toHaveLength(0);
		expect(button.closest("form")?.getAttribute("hx-target")).toBe("closest .readlist-article");
	});

	it("splits a confirmed status action into a popover trigger and a renamed fallback form", () => {
		const html = renderReadlistCard(
			display(
				makeViewModel({
					actions: [
						{ ...MARK_READ_ACTION, confirmPopoverId: "readlist-mark-status-confirm-abc123" },
						DELETE_ACTION,
					],
				}),
				{ isFirst: false },
			),
		);
		const doc = parse(html);
		const trigger = doc.querySelector("[data-test-action='mark-read']");
		const fallback = doc.querySelector("[data-test-action='mark-read-fallback']");

		assert(trigger, "the popover trigger must take the status action's own test hook");
		assert(fallback, "the plain form must stay behind as the no-popover fallback");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-mark-status-confirm-abc123");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.textContent).toBe("Mark as read");
		expect(trigger.closest("form")).toBeNull();
		expect(fallback.getAttribute("type")).toBe("submit");
		expect(fallback.closest("form")?.classList.contains("readlist-article__status-fallback")).toBe(
			true,
		);
	});

	it("keeps the trigger id-free so the toast focus hook still names exactly one button", () => {
		const html = renderReadlistCard(
			display(
				makeViewModel({
					actions: [
						{ ...MARK_READ_ACTION, confirmPopoverId: "readlist-mark-status-confirm-abc123" },
						DELETE_ACTION,
					],
				}),
				{ isFirst: false },
			),
		);
		const doc = parse(html);

		expect(doc.querySelectorAll("#readlist-status-abc123")).toHaveLength(1);
		expect(doc.querySelector("#readlist-status-abc123")?.getAttribute("data-test-action")).toBe(
			"mark-read-fallback",
		);
	});

	it("shows a processing state and disables the status action while the card is still being fetched", () => {
		const html = renderReadlistCard(
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
			!processing.classList.contains("readlist-article__processing--hidden"),
			"processing indicator must be visible while polling",
		);
		expect(doc.querySelector("[data-test-action='mark-read']")?.hasAttribute("disabled")).toBe(true);
		expect(doc.querySelector("[data-test-action='delete']")?.hasAttribute("disabled")).toBe(false);
	});

	it("hides the processing state and enables the status action once the card is terminal", () => {
		const html = renderReadlistCard(
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
			processing.classList.contains("readlist-article__processing--hidden"),
			"processing indicator must be hidden when card is terminal",
		);
		expect(doc.querySelector("[data-test-action='mark-read']")?.hasAttribute("disabled")).toBe(false);
	});
});
