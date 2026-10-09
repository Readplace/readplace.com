import assert from "node:assert/strict";
import { READLIST_LABEL_MAX_LENGTH, ReadlistSlugSchema } from "@packages/domain/readlist";
import { iconSvg } from "@packages/ui-icons";
import { JSDOM } from "jsdom";
import { READLIST_KIND_ICON } from "../../shared/readlist-kind-icon";
import { readlistDeleteConfirmPopoverId } from "./readlist-delete-confirm.component";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { buildReadlistNav, renderReadlistNav } from "./readlist-nav.component";
import {
	readlistRenameFallbackInputId,
	readlistRenamePopoverId,
} from "./readlist-rename.component";
import { READLIST_NAME_FIELD } from "./readlist-name-form.component";
import { READLIST_CREATE_POPOVER_ID } from "./readlist-create.component";

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

const FILE_PATH_D = firstPathD(iconSvg("file"));
const FOLDER_PATH_D = firstPathD(iconSvg("folder"));

function readlistsWithMenu(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-readlist-menu]"), (el) =>
		el.getAttribute("data-test-readlist-menu"),
	);
}

describe("buildReadlistNav", () => {
	it("draws the built-in readlist with the file icon", () => {
		const doc = renderNav();

		expect(iconPathD(readlistLink(doc, "default"))).toBe(FILE_PATH_D);
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
		expect(edit.parentElement?.classList.contains("menu__panel")).toBe(true);
		expect(edit.classList.contains("menu__item")).toBe(true);
	});

	it("opens a custom readlist's menu on a Delete control that targets its delete confirmation", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const menu = doc.querySelector('[data-test-readlist-menu="work"]');
		assert(menu, "a custom readlist must carry its own menu");
		const del = menu.querySelector('[data-test-action="readlist-delete"]');
		assert(del, "the menu must offer a Delete control");
		expect(del.getAttribute("popovertarget")).toBe(readlistDeleteConfirmPopoverId(WORK.slug));
		expect(del.getAttribute("aria-haspopup")).toBe("dialog");
		expect(del.parentElement?.classList.contains("menu__panel")).toBe(true);
		expect(del.classList.contains("menu__item")).toBe(true);
	});

	it("gates both the Edit and Delete triggers behind popover support", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const menu = doc.querySelector('[data-test-readlist-menu="work"]');
		assert(menu, "a custom readlist must carry its own menu");
		const edit = menu.querySelector('[data-test-action="readlist-rename"]');
		assert(edit, "the menu must offer an Edit control");
		const del = menu.querySelector('[data-test-action="readlist-delete"]');
		assert(del, "the menu must offer a Delete control");
		expect(edit.classList.contains("readlist-nav__confirm-trigger")).toBe(true);
		expect(del.classList.contains("readlist-nav__confirm-trigger")).toBe(true);
	});

	it("backs the rename trigger with a plain-post fallback that carries the current name and its own field", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const save = doc.querySelector('[data-test-action="readlist-rename-fallback"]');
		assert(save, "the menu must keep a no-popover fallback for renaming");
		const form = save.closest("form");
		assert(form, "the fallback must submit through a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-boost")).toBe("false");
		const action = new URL(form.getAttribute("action") ?? "", "https://internal.invalid");
		expect(action.pathname).toBe(`/queue/queues/${WORK.slug}/rename`);
		expect(action.searchParams.get("utm_source")).toBe("queue-nav");
		expect(action.searchParams.get("utm_content")).toBe("rename-readlist");

		const inputId = readlistRenameFallbackInputId(WORK.slug);
		const input = form.querySelector<HTMLInputElement>(`#${inputId}`);
		assert(input, "the fallback must carry a labelled name input");
		expect(input.getAttribute("name")).toBe(READLIST_NAME_FIELD);
		expect(input.getAttribute("value")).toBe(WORK.label);
		expect(input.getAttribute("maxlength")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(input.hasAttribute("required")).toBe(true);
		expect(inputId).not.toBe(`${readlistRenamePopoverId(WORK.slug)}-name`);

		const label = form.querySelector(`label[for="${inputId}"]`);
		assert(label, "the fallback input must be labelled");
		expect(label.textContent).toBe("Readlist name");
		expect(doc.querySelectorAll(`#${inputId}`)).toHaveLength(1);
	});

	it("draws the rename fallback's label and name input with the shared form-field look", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		const inputId = readlistRenameFallbackInputId(WORK.slug);
		const input = doc.getElementById(inputId);
		assert(input, "the fallback must carry its name input");
		const label = doc.querySelector(`label[for="${inputId}"]`);
		assert(label, "the fallback input must be labelled");
		expect(input.classList.contains("form-input")).toBe(true);
		expect(label.classList.contains("form-field__label")).toBe(true);
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

		expect(readlistLink(doc, "work").getAttribute("class")).toBe("readlist-row__main readlist-nav__link");
		expect(readlistLink(doc, "work").parentElement?.className).toBe(
			"readlist-row readlist-nav__item readlist-row--selected",
		);
		expect(readlistLink(doc, "default").getAttribute("class")).toBe("readlist-row__main readlist-nav__link");
		expect(readlistLink(doc, "default").parentElement?.className).toBe("readlist-row readlist-nav__item");
	});

	it("tells assistive tech which readlist the reader is on, and only that one", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(readlistLink(doc, "work").getAttribute("aria-current")).toBe("page");
		expect(readlistLink(doc, "default").hasAttribute("aria-current")).toBe(false);
	});

	it("names the viewed readlist in the switcher summary with its readlist-kind icon", () => {
		for (const { activeSlug, kind, label } of [
			{ activeSlug: DEFAULT_READLIST.slug, kind: "default", label: DEFAULT_READLIST.label },
			{ activeSlug: WORK.slug, kind: "custom", label: WORK.label },
		] as const) {
			const doc = renderNav({ activeSlug });

			const summary = doc.querySelector('[data-test-action="readlist-switcher"]');
			assert(summary, "the rail must open from a switcher summary");
			expect(summary.textContent?.replace(/\s+/g, " ").trim()).toBe(`Current readlist: ${label}`);
			expect(iconPathD(summary)).toBe(firstPathD(iconSvg(READLIST_KIND_ICON[kind])));
		}
	});

	it("keeps every readlist row and the create row inside the switcher", () => {
		const doc = renderNav();

		const switcher = doc.querySelector("[data-test-readlist-switcher]");
		assert(switcher, "the rail must wrap its rows in the switcher");
		const rows = Array.from(switcher.querySelectorAll("[data-test-readlist]"), (el) =>
			el.getAttribute("data-test-readlist"),
		);
		expect(rows).toEqual(["default", "work"]);
		expect(doc.querySelectorAll("[data-test-readlist]")).toHaveLength(2);
		expect(switcher.querySelectorAll('[data-test-action="new-readlist"]')).toHaveLength(1);
	});

	it("opens the create dialog from the create row", () => {
		const doc = renderNav();

		const trigger = doc.querySelector('[data-test-action="new-readlist"]');
		assert(trigger, "the rail must offer a create row");
		expect(trigger.getAttribute("popovertarget")).toBe(READLIST_CREATE_POPOVER_ID);
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.classList.contains("readlist-nav__confirm-trigger")).toBe(true);
	});

	it("backs the create dialog with a plain-post fallback that names the readlist, tagged for funnel attribution", () => {
		const doc = renderNav();

		const save = doc.querySelector('[data-test-action="readlist-create-fallback"]');
		assert(save, "the rail must keep a no-popover fallback for creating");
		const form = save.closest("form");
		assert(form, "the fallback must submit through a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-boost")).toBe("false");
		expect(form.getAttribute("action")).toBe(
			"/queue/queues?utm_source=queue-nav&utm_medium=internal&utm_content=new-readlist",
		);
		const input = form.querySelector<HTMLInputElement>("input#readlist-create-fallback-name");
		assert(input, "the fallback must carry its name input");
		expect(input.getAttribute("name")).toBe(READLIST_NAME_FIELD);
		expect(input.getAttribute("maxlength")).toBe(String(READLIST_LABEL_MAX_LENGTH));
		expect(input.getAttribute("placeholder")).toBe("Enter readlist name");
		expect(input.hasAttribute("required")).toBe(true);
		const label = form.querySelector('label[for="readlist-create-fallback-name"]');
		assert(label, "the fallback input must be labelled");
		expect(label.textContent).toBe("Readlist name");
	});

	it("withholds the create form and every readlist menu from a reader who cannot write", () => {
		const doc = renderNav({ activeSlug: WORK.slug, canCreate: false });

		expect(doc.querySelectorAll('[data-test-action="new-readlist"]')).toHaveLength(0);
		expect(readlistsWithMenu(doc)).toEqual([]);
		expect(doc.querySelectorAll("[data-test-readlist]")).toHaveLength(2);
	});
});
