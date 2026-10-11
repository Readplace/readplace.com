import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { iconSvg } from "@packages/ui-icons";
import type { DeviceClass } from "@packages/web-analytics";
import { JSDOM } from "jsdom";
import type { ArticleAction, ReadlistArticleViewModel } from "../readlist.viewmodel";
import { type ArticleMoveViewModel, moveCreatePopoverId, moveDialogPopoverId } from "./move-dialog.component";
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
		readTime: { value: "3", label: "3 min read" },
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
const MOVE: ArticleMoveViewModel = {
	articleId: "abc123",
	popoverId: moveDialogPopoverId("abc123"),
	mode: "move",
	from: ReadlistSlugSchema.parse("work"),
	url: "/queue/abc123/move?queue=work",
	destinations: [{ slug: ReadlistSlugSchema.parse("finance"), label: "Finance" }],
	create: { popoverId: moveCreatePopoverId("abc123") },
	opens: moveDialogPopoverId("abc123"),
};

function menuPanel(doc: Document): Element {
	const panel = doc.querySelector("[data-test-article-menu] .menu__panel");
	assert(panel, "the card must render its ••• menu panel");
	return panel;
}

function menuControls(doc: Document): (string | null)[] {
	return Array.from(menuPanel(doc).querySelectorAll("[data-test-action]"), (control) =>
		control.getAttribute("data-test-action"),
	);
}

function glyph(name: "envelope" | "folder-input" | "trash"): string {
	const svg = parse(iconSvg(name)).querySelector("svg");
	assert(svg, `the ${name} icon must be an svg drawing`);
	return svg.innerHTML;
}

function viaFallback(doc: Document): Element {
	const fallback = doc.querySelector("[data-test-article-via-fallback]");
	assert(fallback, "the plain via fact a browser without popovers shows must always be rendered");
	return fallback;
}

function metaRow(doc: Document): string[] {
	const meta = doc.querySelector(".readlist-article__meta");
	assert(meta, "the meta row must be present");
	return Array.from(meta.children, (child) => child.className);
}

describe("renderReadlistCard", () => {
	it("opens the reader from exactly the title and the excerpt, each with its own tracking", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel(), { isFirst: false, deviceClass: "mobile_ios" })),
		);

		const openers = Array.from(doc.querySelectorAll("[data-opens-reader]"), (link) => ({
			isTitle: link.hasAttribute("data-test-article-title"),
			isExcerpt: link.hasAttribute("data-test-article-excerpt"),
			content: urlParams(link.getAttribute("href")).get("utm_content"),
			term: urlParams(link.getAttribute("href")).get("utm_term"),
		}));
		expect(openers).toEqual([
			{ isTitle: true, isExcerpt: false, content: "open-article-title", term: "mobile_ios" },
			{ isTitle: false, isExcerpt: true, content: "open-article-excerpt", term: "mobile_ios" },
		]);
	});

	it("leads the foot with the meta row on a terminal card and the Processing line on a pending one", () => {
		const leadingSlot = (vm: ReadlistArticleViewModel) => {
			const foot = parse(renderReadlistCard(display(vm, { isFirst: false }))).querySelector(
				".readlist-article__foot",
			);
			assert(foot, "the card must render its foot");
			return Array.from(foot.children, (child) => child.getAttribute("class")).slice(0, 2);
		};

		expect(leadingSlot(makeViewModel())).toEqual([
			"readlist-article__processing readlist-article__processing--hidden",
			"readlist-article__meta",
		]);
		expect(leadingSlot(makeViewModel({ cardPollUrl: "/queue/abc123/card?poll=1" }))).toEqual([
			"readlist-article__processing",
			"readlist-article__meta readlist-article__meta--hidden",
		]);
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
		expect(trigger.parentElement?.classList.contains("menu__panel")).toBe(true);
		expect(trigger.classList.contains("menu__item")).toBe(true);

		const fallback = doc.querySelector('[data-test-action="delete-fallback"]');
		assert(fallback, "a no-popover delete fallback must be present");
		expect(fallback.getAttribute("type")).toBe("submit");
		const fallbackForm = fallback.closest("form");
		assert(fallbackForm, "the fallback must submit through a form");
		expect(fallbackForm.classList.contains("readlist-article__fallback")).toBe(true);
	});

	it("lists the move item ahead of Delete when Delete asks first", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ actions: [DELETE_ACTION], move: MOVE }), { isFirst: false })),
		);

		expect(menuControls(doc)).toEqual(["move-fallback", "move", "delete-fallback", "delete"]);
	});

	it("lists the move item ahead of Delete when Delete posts straight away", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ actions: [UNCONFIRMED_DELETE_ACTION], move: MOVE }), { isFirst: false }),
			),
		);

		expect(menuControls(doc)).toEqual(["move-fallback", "move", "delete"]);
	});

	it("draws the move item with folder-input while Delete keeps its trash glyph", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ actions: [DELETE_ACTION], move: MOVE }), { isFirst: false })),
		);

		const move = menuPanel(doc).querySelector('[data-test-action="move"]');
		const remove = menuPanel(doc).querySelector('[data-test-action="delete"]');
		assert(move, "the move item must be present");
		assert(remove, "the delete item must be present");
		expect(move.querySelector("svg")?.innerHTML).toBe(glyph("folder-input"));
		expect(remove.querySelector("svg")?.innerHTML).toBe(glyph("trash"));
	});

	it("points the move item at the dialog the page renders for the article", () => {
		const doc = parse(
			renderReadlistCard(display(makeViewModel({ actions: [DELETE_ACTION], move: MOVE }), { isFirst: false })),
		);

		const move = menuPanel(doc).querySelector('[data-test-action="move"]');
		assert(move, "the move item must be present");
		expect(move.getAttribute("popovertarget")).toBe("readlist-move-abc123");
		expect(move.parentElement).toBe(menuPanel(doc));
	});

	it("offers only Delete when the article has nowhere to move to", () => {
		const doc = parse(renderReadlistCard(display(makeViewModel({ actions: [DELETE_ACTION] }), { isFirst: false })));

		expect(menuControls(doc)).toEqual(["delete-fallback", "delete"]);
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

	it("removes the via fact from a card whose save did not arrive by email", () => {
		const doc = parse(renderReadlistCard(display(makeViewModel(), { isFirst: false })));

		const via = doc.querySelector("[data-test-article-via]");
		assert(via, "the via fact must always be rendered");
		expect(via.tagName.toLowerCase()).toBe("span");
		expect(via.classList.contains("readlist-article__via--empty")).toBe(true);
		expect(via.textContent).toBe("");
		expect(viaFallback(doc).isSameNode(via)).toBe(true);
		expect(metaRow(doc)).toEqual([
			"readlist-article__site",
			"readlist-article__saved",
			"readlist-article__read-time",
			"readlist-article__via readlist-article__via--empty",
		]);
	});

	it("names the sender an emailed save arrived from, after the read time, as the plain fact alone with no popover to open", () => {
		const doc = parse(
			renderReadlistCard(
				display(makeViewModel({ via: { label: "via news@example.com", iconSvg: iconSvg("envelope") } }), {
					isFirst: false,
				}),
			),
		);

		const via = doc.querySelector("[data-test-article-via]");
		assert(via, "the via fact must always be rendered");
		expect(via.tagName.toLowerCase()).toBe("span");
		expect(via.classList.contains("readlist-article__via--empty")).toBe(false);
		expect(via.getAttribute("title")).toBe("via news@example.com");
		expect(via.querySelector("svg")?.innerHTML).toBe(glyph("envelope"));
		const label = via.querySelector(".readlist-article__via-label");
		assert(label, "the via label span must be rendered");
		expect(label.textContent).toBe("via news@example.com");
		expect(viaFallback(doc).isSameNode(via)).toBe(true);
		expect(metaRow(doc)).toEqual([
			"readlist-article__site",
			"readlist-article__saved",
			"readlist-article__read-time",
			"readlist-article__via",
		]);
	});

	it("names the newsletter a catalogued sender publishes, keeping the address on hover, behind a tap, and on the plain fact a browser without popovers shows", () => {
		const doc = parse(
			renderReadlistCard(
				display(
					makeViewModel({ via: { label: "via TLDR", iconSvg: iconSvg("envelope"), senderEmail: "dan@tldr.tech" } }),
					{ isFirst: false },
				),
			),
		);

		const via = doc.querySelector("[data-test-article-via]");
		assert(via, "the via fact must always be rendered");
		expect(via.tagName.toLowerCase()).toBe("button");
		expect(via.getAttribute("type")).toBe("button");
		expect(via.getAttribute("popovertarget")).toBe("readlist-via-abc123");
		expect(via.getAttribute("title")).toBe("dan@tldr.tech");
		expect(via.classList.contains("sender-popover__trigger")).toBe(true);
		expect(via.querySelector(".readlist-article__via-label")?.textContent).toBe("via TLDR");
		const fallback = viaFallback(doc);
		expect(fallback.tagName.toLowerCase()).toBe("span");
		expect(fallback.getAttribute("title")).toBe("dan@tldr.tech");
		expect(fallback.querySelector("svg")?.innerHTML).toBe(glyph("envelope"));
		expect(fallback.querySelector(".readlist-article__via-label")?.textContent).toBe("via TLDR");
		const sender = doc.querySelector("#readlist-via-abc123");
		assert(sender, "the sender popover must render for a named newsletter");
		expect(sender.getAttribute("popover")).toBe("auto");
		expect(sender.hasAttribute("data-test-article-via-sender")).toBe(true);
		expect(sender.textContent).toBe("dan@tldr.tech");
		expect(metaRow(doc)).toEqual([
			"readlist-article__site",
			"readlist-article__saved",
			"readlist-article__read-time",
			"readlist-article__via sender-popover__fallback",
			"readlist-article__via sender-popover__trigger",
			"sender-popover",
		]);
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
				display(makeViewModel({ readTime: { value: "3", label: "3 min read" } }), { isFirst: false }),
			),
		);

		const readTime = doc.querySelector("[data-test-read-time]");
		assert(readTime, "the read-time part must always be rendered");
		expect(readTime.textContent).toBe("3 min read");
		expect(readTime.classList.contains("readlist-article__read-time--empty")).toBe(false);
	});

	it("hands the reader skeleton the saved time the card shows", () => {
		const doc = parse(renderReadlistCard(display(makeViewModel(), { isFirst: false })));

		const saved = doc.querySelector('[data-reader-field="saved"]');
		assert(saved, "the saved time must carry the reader field hook");
		expect(saved.tagName.toLowerCase()).toBe("time");
		expect(saved.getAttribute("datetime")).toBe("2025-06-01T12:50:00.000Z");
		expect(saved.textContent).toBe("10m ago");
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
