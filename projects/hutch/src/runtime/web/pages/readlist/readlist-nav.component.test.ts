import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH, ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { buildReadlistNav, renderReadlistNav } from "./readlist-nav.component";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";

const WORK: Readlist = { slug: ReadlistSlugSchema.parse("work"), label: "Work Reading" };
const READLISTS: readonly Readlist[] = [DEFAULT_READLIST, WORK];

function renderNav(overrides: Partial<Parameters<typeof buildReadlistNav>[0]> = {}): Document {
	const input = {
		readlists: READLISTS,
		activeSlug: DEFAULT_READLIST.slug,
		linkParams: [["feature", "queues"]] as const,
		newReadlistAction: "/queue/queues?feature=queues",
		canCreate: true,
		...overrides,
	};
	return new JSDOM(`<main>${renderReadlistNav(buildReadlistNav(input))}</main>`).window.document;
}

function readlistLink(doc: Document, testReadlist: string): Element {
	const link = doc.querySelector(`[data-test-readlist="${testReadlist}"]`);
	assert(link, `the ${testReadlist} readlist must be rendered`);
	return link;
}

function queueLabel(doc: Document, testReadlist: string): string | null {
	const label = readlistLink(doc, testReadlist).querySelector(".readlist-nav__label");
	assert(label, `the ${testReadlist} readlist must carry its name in an element of its own`);
	return label.textContent;
}

function renameable(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-readlist-rename]"), (el) =>
		el.getAttribute("data-test-readlist"),
	);
}

function deletable(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll('[data-test-action="readlist-delete"]'), (el) =>
		el.getAttribute("popovertarget"),
	);
}

function deleteFallbackActions(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll(".readlist-nav__delete-fallback"), (el) =>
		el.getAttribute("action"),
	);
}

function hrefParts(link: Element): { path: string; params: URLSearchParams } {
	const url = new URL(link.getAttribute("href") ?? "", "https://internal.invalid");
	return { path: url.pathname, params: url.searchParams };
}

describe("buildReadlistNav", () => {
	it("should render one link per readlist, in the order the readlists are given", () => {
		const doc = renderNav();

		const rendered = Array.from(doc.querySelectorAll("[data-test-readlist]")).map((el) =>
			el.getAttribute("data-test-readlist"),
		);
		expect(rendered).toEqual(["default", "work"]);
	});

	it("should title each readlist from the label the reader gave it", () => {
		const doc = renderNav();

		expect(readlistLink(doc, "default").textContent).toBe("All");
		expect(readlistLink(doc, "work").textContent).toBe("Work Reading");
	});

	it("should tell assistive tech which readlist the reader is on, and only that one", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(readlistLink(doc, "work").getAttribute("aria-current")).toBe("page");
		expect(readlistLink(doc, "default").getAttribute("aria-current")).toBeNull();
	});

	it("should mark the viewed readlist's tab so it reads as the selected one", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(readlistLink(doc, "work").getAttribute("class")).toBe(
			"readlist-nav__link readlist-nav__link--active",
		);
		expect(readlistLink(doc, "default").getAttribute("class")).toBe("readlist-nav__link");
	});

	it("should point each readlist at its own listing with its own tracking token", () => {
		const doc = renderNav();

		const forDefault = hrefParts(readlistLink(doc, "default"));
		expect(forDefault.path).toBe("/queue");
		expect(forDefault.params.get("queue")).toBeNull();
		expect(forDefault.params.get("utm_content")).toBe("queue-default");

		const forWork = hrefParts(readlistLink(doc, "work"));
		expect(forWork.path).toBe("/queue");
		expect(forWork.params.get("queue")).toBe("work");
		expect(forWork.params.get("utm_source")).toBe("queue-nav");
		expect(forWork.params.get("utm_content")).toBe("queue-work");
	});

	it("should carry the readlists toggle onto every readlist link so the rail survives the click", () => {
		const doc = renderNav();

		for (const slug of ["default", "work"]) {
			expect(hrefParts(readlistLink(doc, slug)).params.get("feature")).toBe("queues");
		}
	});

	it("should open a readlist at its own default view rather than carrying the read-state tab and sort", () => {
		const doc = renderNav();

		const { params } = hrefParts(readlistLink(doc, "work"));
		expect(params.get("tab")).toBeNull();
		expect(params.get("order")).toBeNull();
		expect(params.get("page")).toBeNull();
	});

	it("should list each readlist as its own item so assistive tech announces the set size", () => {
		const doc = renderNav();

		const items = Array.from(doc.querySelectorAll(".readlist-nav__list > .readlist-nav__item")).map(
			(item) => item.querySelector("[data-test-readlist]")?.getAttribute("data-test-readlist"),
		);
		expect(items).toEqual(["default", "work"]);
	});

	it("should start a new readlist by posting, so the readlist exists before it is named", () => {
		const doc = renderNav();

		const form = doc.querySelector("nav.readlist-nav > form.readlist-nav__new-form");
		assert(form, "the new-readlist control must sit beside the readlist list, not inside it");
		const control = form.querySelector('[data-test-action="new-readlist"]');
		assert(control, "the new-readlist control must submit the create form");
		expect({
			method: form.getAttribute("method"),
			action: form.getAttribute("action"),
			type: control.getAttribute("type"),
			label: control.textContent,
		}).toEqual({
			method: "POST",
			action: "/queue/queues?feature=queues",
			type: "submit",
			label: "New readlist",
		});
	});

	it("should withhold the new-readlist control from a reader who cannot write", () => {
		const doc = renderNav({ canCreate: false });

		expect(doc.querySelector('[data-test-action="new-readlist"]')).toBeNull();
		expect(doc.querySelectorAll("[data-test-readlist]")).toHaveLength(2);
	});

	it("should offer the readlist the reader is on for renaming, in place", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const tab = readlistLink(doc, "work");
		expect({
			tagName: tab.tagName,
			action: tab.getAttribute("data-readlist-rename"),
			field: tab.getAttribute("data-readlist-rename-field"),
			max: tab.getAttribute("data-readlist-label-max"),
			current: tab.getAttribute("aria-current"),
			readlist: hrefParts(tab).params.get("queue"),
		}).toEqual({
			tagName: "A",
			action: "/queue/queues/work/rename?feature=queues",
			field: "label",
			max: String(READLIST_LABEL_MAX_LENGTH),
			current: "page",
			readlist: "work",
		});
	});

	it("should opt the renameable tab out of boosting so the reader's own tap opens the editor", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(readlistLink(doc, "work").getAttribute("hx-boost")).toBe("false");
		expect(readlistLink(doc, "default").getAttribute("hx-boost")).toBeNull();
	});

	it("should keep a readlist's name in an element of its own, so editing cannot swallow the pencil", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const tab = readlistLink(doc, "work");
		expect(queueLabel(doc, "work")).toBe("Work Reading");
		expect(tab.querySelectorAll("svg")).toHaveLength(1);
	});

	it("should say what the pencil does for a reader who cannot see it", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const tab = readlistLink(doc, "work");
		expect(tab.getAttribute("aria-label")).toBe("Rename Work Reading");
		expect(tab.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("should leave every readlist the reader is not on a plain link with nothing to rename", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(renameable(doc)).toEqual(["work"]);
		expect(hrefParts(readlistLink(doc, "default")).path).toBe("/queue");
	});

	it("should never offer the built-in readlist for renaming, even when the reader is on it", () => {
		const doc = renderNav({ activeSlug: DEFAULT_READLIST.slug });

		const tab = readlistLink(doc, "default");
		expect(renameable(doc)).toEqual([]);
		expect(tab.getAttribute("aria-current")).toBe("page");
		expect(hrefParts(tab).path).toBe("/queue");
	});

	it("should withhold renaming from a reader who cannot write", () => {
		const doc = renderNav({ canCreate: false, activeSlug: WORK.slug });

		expect(renameable(doc)).toEqual([]);
		expect(hrefParts(readlistLink(doc, "work")).params.get("queue")).toBe("work");
	});

	it("should offer the readlist the reader is on for deleting, from its own trigger", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(deletable(doc)).toEqual(["readlist-remove-confirm-work"]);
	});

	it("should back the delete trigger with a plain post for a reader with no popover", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(deleteFallbackActions(doc)).toEqual(["/queue/queues/work/delete?feature=queues"]);
	});

	it("should keep the delete trigger outside the tab so a tap cannot open the name editor", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const trigger = doc.querySelector('[data-test-action="readlist-delete"]');
		assert(trigger, "the readlist the reader is on must offer a delete trigger");
		expect(trigger.closest("[data-readlist-rename]")).toBeNull();
		expect(trigger.closest(".readlist-nav__item")).toBe(readlistLink(doc, "work").parentElement);
	});

	it("should say which readlist the delete control removes, for a reader who cannot see it", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const label = doc.querySelector('[data-test-action="readlist-delete"] .sr-only');
		assert(label, "the delete trigger must name its readlist for assistive tech");
		expect(label.textContent).toBe("Delete Work Reading");
	});

	it("should leave every readlist the reader is not on with nothing to delete", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(deletable(doc)).toEqual(["readlist-remove-confirm-work"]);
		expect(readlistLink(doc, "default").parentElement?.className).toBe("readlist-nav__item");
	});

	it("should never offer the built-in readlist for deleting, even when the reader is on it", () => {
		const doc = renderNav({ activeSlug: DEFAULT_READLIST.slug });

		expect(deletable(doc)).toEqual([]);
	});

	it("should withhold deleting from a reader who cannot write", () => {
		const doc = renderNav({ canCreate: false, activeSlug: WORK.slug });

		expect(deletable(doc)).toEqual([]);
	});

	it("should name the landmark so it is distinguishable from the page's other navs", () => {
		const doc = renderNav();

		const nav = doc.querySelector("nav.readlist-nav");
		assert(nav, "the readlist nav must be a navigation landmark");
		expect(nav.getAttribute("aria-label")).toBe("Readlists");
	});
});
