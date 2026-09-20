import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { iconSvg } from "@packages/ui-icons";
import { JSDOM } from "jsdom";
import { readlistDeleteConfirmPopoverId } from "./readlist-delete-confirm.component";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { buildReadlistNav, renderReadlistNav } from "./readlist-nav.component";
import { readlistRenamePopoverId } from "./readlist-rename.component";

const WORK: Readlist = { slug: ReadlistSlugSchema.parse("work"), label: "Work Reading" };
const READLISTS: readonly Readlist[] = [DEFAULT_READLIST, WORK];

function renderNav(overrides: Partial<Parameters<typeof buildReadlistNav>[0]> = {}): Document {
	const input = {
		readlists: READLISTS,
		activeSlug: DEFAULT_READLIST.slug,
		newReadlistAction: "/queue/queues",
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

function hrefParts(link: Element): { path: string; params: URLSearchParams } {
	const url = new URL(link.getAttribute("href") ?? "", "https://internal.invalid");
	return { path: url.pathname, params: url.searchParams };
}

function firstPathD(svgMarkup: string): string {
	const path = new JSDOM(svgMarkup).window.document.querySelector("path");
	assert(path, "icon markup must render at least one path");
	const d = path.getAttribute("d");
	assert(d, "icon path must carry geometry");
	return d;
}

function iconPathD(link: Element): string {
	const path = link.querySelector("path");
	assert(path, "a readlist link must draw an icon");
	const d = path.getAttribute("d");
	assert(d, "the icon path must carry geometry");
	return d;
}

const BOOK_PATH_D = firstPathD(iconSvg("book"));
const FOLDER_PATH_D = firstPathD(iconSvg("folder"));

function readlistsWithMenu(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-readlist-menu]"), (el) =>
		el.getAttribute("data-test-readlist-menu"),
	);
}

describe("buildReadlistNav", () => {
	it("draws the built-in readlist with the book icon", () => {
		const doc = renderNav();

		expect(iconPathD(readlistLink(doc, "default"))).toBe(BOOK_PATH_D);
	});

	it("carries no menu for the built-in readlist", () => {
		const doc = renderNav({ readlists: [DEFAULT_READLIST] });

		expect(readlistsWithMenu(doc)).toEqual([]);
	});

	it("draws a custom readlist with the folder icon and its own menu", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(iconPathD(readlistLink(doc, "work"))).toBe(FOLDER_PATH_D);
		expect(readlistsWithMenu(doc)).toEqual(["work"]);
	});

	it("opens a custom readlist's menu on an Edit control that targets its rename popover", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const menu = doc.querySelector('[data-test-readlist-menu="work"]');
		assert(menu, "a custom readlist must carry its own menu");
		const edit = menu.querySelector('[data-test-action="readlist-rename"]');
		assert(edit, "the menu must offer an Edit control");
		expect(edit.getAttribute("popovertarget")).toBe(readlistRenamePopoverId(WORK.slug));
		expect(edit.getAttribute("aria-haspopup")).toBe("dialog");
	});

	it("opens a custom readlist's menu on a Delete control that targets its delete confirmation", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const menu = doc.querySelector('[data-test-readlist-menu="work"]');
		assert(menu, "a custom readlist must carry its own menu");
		const del = menu.querySelector('[data-test-action="readlist-delete"]');
		assert(del, "the menu must offer a Delete control");
		expect(del.getAttribute("popovertarget")).toBe(readlistDeleteConfirmPopoverId(WORK.slug));
		expect(del.getAttribute("aria-haspopup")).toBe("dialog");
	});

	it("backs the delete trigger with a plain-post fallback carrying the return state", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const fallback = doc.querySelector('[data-test-action="readlist-delete-fallback"]');
		assert(fallback, "the menu must keep a no-popover fallback for deleting");
		const form = fallback.closest("form");
		assert(form, "the fallback must submit through a form");
		expect(form.getAttribute("method")).toBe("POST");
		const action = new URL(form.getAttribute("action") ?? "", "https://internal.invalid");
		expect(action.pathname).toBe(`/queue/queues/${WORK.slug}/delete`);
		expect(action.searchParams.get("queue")).toBe(WORK.slug);
		expect(action.searchParams.get("utm_source")).toBe("queue-nav");
		expect(action.searchParams.get("utm_content")).toBe("delete-readlist");
	});

	it("points each readlist's link at its own listing with its own tracking token", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const forDefault = hrefParts(readlistLink(doc, "default"));
		expect(forDefault.path).toBe("/queue");
		expect(forDefault.params.get("utm_content")).toBe("queue-default");

		const forWork = hrefParts(readlistLink(doc, "work"));
		expect(forWork.path).toBe("/queue");
		expect(forWork.params.get("queue")).toBe("work");
		expect(forWork.params.get("utm_content")).toBe("queue-work");
	});

	it("marks the viewed readlist's link and item as the selected one, and leaves the others plain", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(readlistLink(doc, "work").getAttribute("class")).toBe(
			"readlist-nav__link readlist-nav__link--active",
		);
		expect(readlistLink(doc, "work").parentElement?.className).toBe(
			"readlist-nav__item readlist-nav__item--active",
		);
		expect(readlistLink(doc, "default").getAttribute("class")).toBe("readlist-nav__link");
		expect(readlistLink(doc, "default").parentElement?.className).toBe("readlist-nav__item");
	});

	it("tells assistive tech which readlist the reader is on, and only that one", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(readlistLink(doc, "work").getAttribute("aria-current")).toBe("page");
		expect(readlistLink(doc, "default").hasAttribute("aria-current")).toBe(false);
	});

	it("starts a new readlist by posting, tagged for funnel attribution", () => {
		const doc = renderNav();

		const form = doc.querySelector("form.readlist-nav__new-form");
		assert(form, "the create control must sit beside the readlist list");
		const control = form.querySelector('[data-test-action="new-readlist"]');
		assert(control, "the create control must submit the create form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(
			"/queue/queues?utm_source=queue-nav&utm_medium=internal&utm_content=new-readlist",
		);
	});

	it("withholds the create form and every readlist menu from a reader who cannot write", () => {
		const doc = renderNav({ activeSlug: WORK.slug, canCreate: false });

		expect(doc.querySelectorAll('[data-test-action="new-readlist"]')).toHaveLength(0);
		expect(readlistsWithMenu(doc)).toEqual([]);
		expect(doc.querySelectorAll("[data-test-readlist]")).toHaveLength(2);
	});
});
