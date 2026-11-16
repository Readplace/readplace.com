import assert from "node:assert/strict";
import {
	READLIST_LABEL_MAX_LENGTH,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import { iconSvg } from "@packages/ui-icons";
import { JSDOM } from "jsdom";
import { READLIST_KIND_ICON } from "../../shared/readlist-kind-icon";
import type { UpgradeOffer } from "../../shared/upgrade-offer/upgrade-offer";
import { readlistDeleteConfirmPopoverId } from "./readlist-delete-confirm.component";
import { DEFAULT_READLIST, type Readlist } from "./readlist.nav";
import { buildReadlistNav, renderReadlistNav } from "./readlist-nav.component";
import {
	readlistRenameFallbackInputId,
	readlistRenamePopoverId,
} from "./readlist-rename.component";
import { READLIST_NAME_FIELD } from "./readlist-name-form.component";
import { READLIST_CREATE_POPOVER_ID } from "./readlist-create.component";

const WORK: Readlist = {
	slug: ReadlistSlugSchema.parse("work"),
	label: "Work Reading",
};
const READLISTS: readonly Readlist[] = [DEFAULT_READLIST, WORK];
const OFFER: UpgradeOffer = {
	popoverId: "subscribe-plans",
	plansPath: "/account/plans",
	checkedPlan: "monthly",
};

function renderNav(
	overrides: Partial<Parameters<typeof buildReadlistNav>[0]> = {},
): Document {
	const input = {
		readlists: READLISTS,
		pinnedReadlists: [],
		activeSlug: DEFAULT_READLIST.slug,
		newReadlistAction: "/queue/queues",
		limitAlertHref: "/queue?queue_error=limit",
		canEdit: true,
		canCreate: true,
		offer: undefined,
		...overrides,
	};
	return new JSDOM(`<main>${renderReadlistNav(buildReadlistNav(input))}</main>`)
		.window.document;
}

function readlistLink(doc: Document, testReadlist: string): Element {
	const link = doc.querySelector(`[data-test-readlist="${testReadlist}"]`);
	assert(link, `the ${testReadlist} readlist must be rendered`);
	return link;
}

function hrefParts(link: Element): { path: string; params: URLSearchParams } {
	const url = new URL(
		link.getAttribute("href") ?? "",
		"https://internal.invalid",
	);
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

function createRowActions(doc: Document): (string | null)[] {
	return Array.from(
		doc.querySelectorAll(".readlist-nav__new-row [data-test-action]"),
		(el) => el.getAttribute("data-test-action"),
	);
}

function hiddenFields(form: Element): [string, string][] {
	return Array.from(form.querySelectorAll('input[type="hidden"]'), (field) => [
		field.getAttribute("name") ?? "",
		field.getAttribute("value") ?? "",
	]);
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
		expect(edit.getAttribute("popovertarget")).toBe(
			readlistRenamePopoverId(WORK.slug),
		);
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
		expect(del.getAttribute("popovertarget")).toBe(
			readlistDeleteConfirmPopoverId(WORK.slug),
		);
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

		const save = doc.querySelector(
			'[data-test-action="readlist-rename-fallback"]',
		);
		assert(save, "the menu must keep a no-popover fallback for renaming");
		const form = save.closest("form");
		assert(form, "the fallback must submit through a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-boost")).toBe("false");
		const action = new URL(
			form.getAttribute("action") ?? "",
			"https://internal.invalid",
		);
		expect(action.pathname).toBe(`/queue/queues/${WORK.slug}/rename`);
		expect(action.searchParams.get("utm_source")).toBe("queue-nav");
		expect(action.searchParams.get("utm_content")).toBe("rename-readlist");

		const inputId = readlistRenameFallbackInputId(WORK.slug);
		const input = form.querySelector<HTMLInputElement>(`#${inputId}`);
		assert(input, "the fallback must carry a labelled name input");
		expect(input.getAttribute("name")).toBe(READLIST_NAME_FIELD);
		expect(input.getAttribute("value")).toBe(WORK.label);
		expect(input.getAttribute("maxlength")).toBe(
			String(READLIST_LABEL_MAX_LENGTH),
		);
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

		const fallback = doc.querySelector(
			'[data-test-action="readlist-delete-fallback"]',
		);
		assert(fallback, "the menu must keep a no-popover fallback for deleting");
		const form = fallback.closest("form");
		assert(form, "the fallback must submit through a form");
		expect(form.getAttribute("method")).toBe("POST");
		const action = new URL(
			form.getAttribute("action") ?? "",
			"https://internal.invalid",
		);
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
			"readlist-row__main readlist-nav__link",
		);
		expect(readlistLink(doc, "work").parentElement?.className).toBe(
			"readlist-row readlist-nav__item readlist-row--selected",
		);
		expect(readlistLink(doc, "default").getAttribute("class")).toBe(
			"readlist-row__main readlist-nav__link",
		);
		expect(readlistLink(doc, "default").parentElement?.className).toBe(
			"readlist-row readlist-nav__item",
		);
	});

	it("tells assistive tech which readlist the reader is on, and only that one", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(readlistLink(doc, "work").getAttribute("aria-current")).toBe("page");
		expect(readlistLink(doc, "default").hasAttribute("aria-current")).toBe(
			false,
		);
	});

	it("names the viewed readlist in the switcher summary with its readlist-kind icon", () => {
		for (const { activeSlug, kind, label } of [
			{
				activeSlug: DEFAULT_READLIST.slug,
				kind: "default",
				label: DEFAULT_READLIST.label,
			},
			{ activeSlug: WORK.slug, kind: "custom", label: WORK.label },
		] as const) {
			const doc = renderNav({ activeSlug });

			const summary = doc.querySelector(
				'[data-test-action="readlist-switcher"]',
			);
			assert(summary, "the rail must open from a switcher summary");
			expect(summary.textContent?.replace(/\s+/g, " ").trim()).toBe(
				`Current readlist: ${label}`,
			);
			expect(iconPathD(summary)).toBe(
				firstPathD(iconSvg(READLIST_KIND_ICON[kind])),
			);
		}
	});

	it("keeps every readlist row and the create row inside the switcher", () => {
		const doc = renderNav();

		const switcher = doc.querySelector("[data-test-readlist-switcher]");
		assert(switcher, "the rail must wrap its rows in the switcher");
		const rows = Array.from(
			switcher.querySelectorAll("[data-test-readlist]"),
			(el) => el.getAttribute("data-test-readlist"),
		);
		expect(rows).toEqual(["default", "work"]);
		expect(doc.querySelectorAll("[data-test-readlist]")).toHaveLength(2);
		expect(
			switcher.querySelectorAll('[data-test-action="new-readlist"]'),
		).toHaveLength(1);
	});

	it("opens the create dialog from the create row", () => {
		const doc = renderNav();

		const trigger = doc.querySelector('[data-test-action="new-readlist"]');
		assert(trigger, "the rail must offer a create row");
		expect(trigger.getAttribute("popovertarget")).toBe(
			READLIST_CREATE_POPOVER_ID,
		);
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.classList.contains("readlist-nav__confirm-trigger")).toBe(
			true,
		);
	});

	it("backs the create dialog with a plain-post fallback that names the readlist, tagged for funnel attribution", () => {
		const doc = renderNav();

		const save = doc.querySelector(
			'[data-test-action="readlist-create-fallback"]',
		);
		assert(save, "the rail must keep a no-popover fallback for creating");
		const form = save.closest("form");
		assert(form, "the fallback must submit through a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("hx-boost")).toBe("false");
		expect(form.getAttribute("action")).toBe(
			"/queue/queues?utm_source=queue-nav&utm_medium=internal&utm_content=new-readlist",
		);
		const input = form.querySelector<HTMLInputElement>(
			"input#readlist-create-fallback-name",
		);
		assert(input, "the fallback must carry its name input");
		expect(input.getAttribute("name")).toBe(READLIST_NAME_FIELD);
		expect(input.getAttribute("maxlength")).toBe(
			String(READLIST_LABEL_MAX_LENGTH),
		);
		expect(input.getAttribute("placeholder")).toBe("Enter readlist name");
		expect(input.hasAttribute("required")).toBe(true);
		const label = form.querySelector(
			'label[for="readlist-create-fallback-name"]',
		);
		assert(label, "the fallback input must be labelled");
		expect(label.textContent).toBe("Readlist name");
	});

	it("offers the naming dialog and its fallback from the create row below the cap", () => {
		const doc = renderNav({ activeSlug: WORK.slug });

		expect(createRowActions(doc)).toEqual([
			"new-readlist",
			"readlist-create-fallback",
		]);
		expect(readlistsWithMenu(doc)).toEqual(["work"]);
	});

	it("withholds the create row and every readlist menu from a reader who cannot write", () => {
		const doc = renderNav({
			activeSlug: WORK.slug,
			canEdit: false,
			canCreate: false,
		});

		expect(createRowActions(doc)).toEqual([]);
		expect(readlistsWithMenu(doc)).toEqual([]);
		expect(doc.querySelectorAll("[data-test-readlist]")).toHaveLength(2);
	});

	it("sends the create row to the cap alert without asking for a name once the reader is at the cap", () => {
		const doc = renderNav({
			activeSlug: WORK.slug,
			limitAlertHref: "/queue?queue=work&q=focus&queue_error=limit",
			canCreate: false,
		});

		expect(createRowActions(doc)).toEqual(["readlist-limit"]);
		const button = doc.querySelector('[data-test-action="readlist-limit"]');
		assert(button, "the capped rail must keep its create row");
		expect(button.getAttribute("type")).toBe("submit");
		expect(button.getAttribute("class")).toBe(
			"readlist-row__main readlist-nav__new",
		);
		expect(button.textContent).toBe("Create a readlist");
		expect(iconPathD(button)).toBe(firstPathD(iconSvg("plus")));
		expect(button.closest("[data-test-readlist-switcher]")?.tagName).toBe(
			"DETAILS",
		);
		const form = button.closest("form");
		assert(form, "the capped create row must submit a form");
		expect(form.getAttribute("data-test-form")).toBe("readlist-limit");
		expect(form.getAttribute("method")).toBe("GET");
		expect(form.getAttribute("action")).toBe("/queue");
		expect(form.getAttribute("hx-swap")).toBe(
			"outerHTML show:none scroll:html:top",
		);
		const boosted = form.closest("[hx-boost]");
		assert(boosted, "the limit form must inherit the nav's boost");
		expect(boosted.hasAttribute("data-test-readlist-nav")).toBe(true);
		expect(boosted.getAttribute("hx-boost")).toBe("true");
		expect(boosted.getAttribute("hx-target")).toBe("main");
		expect(boosted.getAttribute("hx-select")).toBe("main");
		expect(hiddenFields(form)).toEqual([
			["queue", "work"],
			["q", "focus"],
			["queue_error", "limit"],
			["utm_source", "queue-nav"],
			["utm_medium", "internal"],
			["utm_content", "readlist-limit"],
		]);
	});

	it("keeps rename and delete on every owned readlist at the cap", () => {
		const doc = renderNav({ activeSlug: WORK.slug, canCreate: false });

		expect(readlistsWithMenu(doc)).toEqual(["work"]);
		const menu = doc.querySelector('[data-test-readlist-menu="work"]');
		assert(menu, "the owned readlist must keep its menu at the cap");
		expect(
			Array.from(menu.querySelectorAll("[data-test-action]"), (el) =>
				el.getAttribute("data-test-action"),
			),
		).toEqual([
			"readlist-menu",
			"readlist-rename",
			"readlist-rename-fallback",
			"readlist-delete",
			"readlist-delete-fallback",
		]);
	});
});

function lockKeys(scope: Document | Element): (string | null)[] {
	return Array.from(
		scope.querySelectorAll('[data-test-action="upgrade-open"]'),
		(el) => el.getAttribute("data-test-needs-upgrade"),
	);
}

describe("readlist rail by upgrade standing", () => {
	it("open: a reader who can write gets the real create row and menu, and no lock, even when an upgrade is on offer", () => {
		const doc = renderNav({ offer: OFFER });

		expect(createRowActions(doc)).toEqual([
			"new-readlist",
			"readlist-create-fallback",
		]);
		expect(readlistsWithMenu(doc)).toEqual([WORK.slug]);
		expect(lockKeys(doc)).toEqual([]);
	});

	it("needs-upgrade: the create row is a lock that opens the plan chooser, without the naming form", () => {
		const doc = renderNav({ canEdit: false, canCreate: false, offer: OFFER });

		const row = doc.querySelector(".readlist-row.readlist-nav__new-row");
		assert(row, "the create row must stay visible");
		const trigger = row.querySelector('[data-test-action="upgrade-open"]');
		const fallback = row.querySelector('[data-test-action="upgrade-fallback"]');
		assert(trigger, "the create row must carry the lock's trigger");
		assert(fallback, "the create row must carry the lock's fallback");
		expect(trigger.getAttribute("data-test-needs-upgrade")).toBe(
			"create-readlist",
		);
		expect(trigger.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(trigger.classList.contains("readlist-nav__new")).toBe(true);
		expect(row.querySelector(".needs-upgrade__label")?.textContent).toBe(
			"Create a readlist",
		);
		expect(fallback.getAttribute("href")).toBe(
			"/account/plans?utm_source=queue-nav&utm_medium=internal&utm_content=upgrade-create-readlist",
		);
		expect(
			doc.querySelectorAll('[data-test-form="readlist-create-fallback"]'),
		).toHaveLength(0);
	});

	it("needs-upgrade: a custom readlist keeps a locked menu holding Edit and Delete, and All has none", () => {
		const doc = renderNav({ canEdit: false, canCreate: false, offer: OFFER });

		expect(readlistsWithMenu(doc)).toEqual([WORK.slug]);
		const menu = doc.querySelector(`[data-test-readlist-menu="${WORK.slug}"]`);
		assert(menu, "the custom readlist must keep its menu");
		expect(menu.getAttribute("data-test-menu-standing")).toBe("locked");
		expect(menu.classList.contains("readlist-nav__menu")).toBe(true);
		expect(lockKeys(menu)).toEqual(["rename-readlist", "delete-readlist"]);
		expect(
			Array.from(
				menu.querySelectorAll('[data-test-action="upgrade-fallback"]'),
				(el) => el.getAttribute("href"),
			),
		).toEqual([
			"/account/plans?utm_source=queue-nav&utm_medium=internal&utm_content=upgrade-rename-readlist",
			"/account/plans?utm_source=queue-nav&utm_medium=internal&utm_content=upgrade-delete-readlist",
		]);
		expect(menu.querySelector(".sr-only")?.textContent).toBe(
			`Options for ${WORK.label}`,
		);
		expect(
			menu.querySelectorAll('[data-test-action="readlist-rename"]'),
		).toHaveLength(0);
	});

	it("withheld: a reader with nothing on offer keeps today's bare rail", () => {
		const doc = renderNav({
			canEdit: false,
			canCreate: false,
			offer: undefined,
		});

		expect(lockKeys(doc)).toEqual([]);
		expect(readlistsWithMenu(doc)).toEqual([]);
		expect(doc.querySelectorAll(".readlist-nav__new-row")).toHaveLength(0);
	});
});

function namedReadlists(count: number): Readlist[] {
	return Array.from({ length: count }, (_, index) => ({
		slug: ReadlistSlugSchema.parse(`r${index + 1}`),
		label: `Readlist ${index + 1}`,
	}));
}

function slug(value: string) {
	return ReadlistSlugSchema.parse(value);
}

function railNames(doc: Document): string[] {
	return Array.from(
		doc.querySelectorAll("[data-test-readlist-rail] [data-test-readlist]"),
		(link) => String(link.getAttribute("data-test-readlist")),
	);
}

function popover(doc: Document, placement: "more" | "sheet"): Element {
	const element = doc.querySelector(
		`[data-test-readlist-popover="${placement}"]`,
	);
	assert(element, `the ${placement} popover must be rendered`);
	return element;
}

function entryNames(element: Element): string[] {
	return Array.from(
		element.querySelectorAll("[data-test-readlist-more-entry]"),
		(link) => String(link.getAttribute("data-test-readlist-more-entry")),
	);
}

describe("readlist nav with more readlists than the rail lists", () => {
	it("keeps today's nav, with no pin form and no More, at 7 named readlists", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(7)],
			pinnedReadlists: [slug("r3")],
		});

		assert.deepEqual(
			Array.from(
				doc.querySelectorAll("[data-test-readlist-switcher] [data-test-readlist]"),
				(link) => link.getAttribute("data-test-readlist"),
			),
			["default", "r1", "r2", "r3", "r4", "r5", "r6", "r7"],
		);
		assert.equal(doc.querySelector("[data-test-readlist-rail]"), null);
		assert.equal(
			doc.querySelector('[data-test-action="more-readlists"]'),
			null,
		);
		assert.equal(
			doc.querySelector(
				'[data-test-form="readlist-pin"], [data-test-form="readlist-unpin"]',
			),
			null,
		);
		assert.equal(doc.querySelectorAll("[data-test-readlist]").length, 8);
	});

	it("lists All and the first 4 named readlists in the rail and counts the rest at 8", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(8)],
		});

		assert.deepEqual(railNames(doc), ["default", "r1", "r2", "r3", "r4"]);
		assert.equal(
			doc
				.querySelector("[data-test-more-count]")
				?.getAttribute("data-test-more-count"),
			"4",
		);
		assert.deepEqual(entryNames(popover(doc, "more")), [
			"r5",
			"r6",
			"r7",
			"r8",
		]);
		assert.deepEqual(entryNames(popover(doc, "sheet")), [
			"default",
			"r1",
			"r2",
			"r3",
			"r4",
			"r5",
			"r6",
			"r7",
			"r8",
		]);
		assert.equal(doc.querySelector("[data-test-readlist-switcher]"), null);
	});

	it("puts pinned readlists in pin order on the rail", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(8)],
			pinnedReadlists: [slug("r6"), slug("r2")],
			activeSlug: slug("r2"),
		});

		assert.deepEqual(railNames(doc), ["default", "r6", "r2", "r1", "r3"]);
		assert.ok(
			readlistLink(doc, "r2")
				.closest("li")
				?.classList.contains("readlist-row--selected"),
		);
	});

	it("lists the current readlist under All when it is not in the rail's slots", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(8)],
			activeSlug: slug("r8"),
		});

		assert.deepEqual(railNames(doc), ["default", "r8", "r1", "r2", "r3", "r4"]);
		assert.equal(readlistLink(doc, "r8").getAttribute("aria-current"), "page");
		assert.equal(
			doc
				.querySelector("[data-test-more-count]")
				?.getAttribute("data-test-more-count"),
			"3",
		);
		const sheetCurrent = popover(doc, "sheet").querySelector(
			'[data-test-readlist-more-entry="r8"]',
		);
		assert.equal(sheetCurrent?.getAttribute("aria-current"), "page");
		assert.ok(
			sheetCurrent
				?.closest("li")
				?.classList.contains("readlist-more__entry--current"),
		);
	});

	it("offers Unpin on a pinned readlist and Pin on the others in every placement", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(20)],
			pinnedReadlists: [slug("r1")],
		});

		const pinnedMenus = doc.querySelectorAll(
			'[data-test-readlist-menu="r1"] [data-test-form="readlist-unpin"]',
		);
		assert.equal(pinnedMenus.length, 2);
		assert.equal(
			doc.querySelector(
				'[data-test-readlist-menu="r1"] [data-test-form="readlist-pin"]',
			),
			null,
		);
		assert.equal(
			new URL(
				String(pinnedMenus[0].getAttribute("action")),
				"https://internal.invalid",
			).pathname,
			"/queue/queues/r1/unpin",
		);
		const pinForms = doc.querySelectorAll(
			'[data-test-readlist-menu="r9"] [data-test-form="readlist-pin"]',
		);
		assert.equal(pinForms.length, 2);
		assert.equal(
			new URL(
				String(pinForms[0].getAttribute("action")),
				"https://internal.invalid",
			).pathname,
			"/queue/queues/r9/pin",
		);
		assert.equal(
			doc.querySelector('[data-test-readlist-menu="default"]'),
			null,
		);
		assert.equal(
			doc
				.querySelector("[data-test-more-count]")
				?.getAttribute("data-test-more-count"),
			"16",
		);
	});

	it("gives each placement's rename field its own id", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(8)],
		});

		const ids = Array.from(
			doc.querySelectorAll("[data-test-readlist-rename-fallback-input]"),
			(input) => input.id,
		);
		assert.equal(new Set(ids).size, ids.length);
	});

	it("autofocuses one entry per popover: More's first entry and the sheet's current readlist", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(8)],
			activeSlug: slug("r2"),
		});

		const moreFocus = popover(doc, "more").querySelectorAll("[autofocus]");
		assert.equal(moreFocus.length, 1);
		assert.equal(
			moreFocus[0].getAttribute("data-test-readlist-more-entry"),
			"r5",
		);
		const sheetFocus = popover(doc, "sheet").querySelectorAll("[autofocus]");
		assert.equal(sheetFocus.length, 1);
		assert.equal(
			sheetFocus[0].getAttribute("data-test-readlist-more-entry"),
			"r2",
		);
		assert.equal(
			doc.querySelectorAll("[data-test-readlist-rail] [autofocus]").length,
			0,
		);
	});

	it("offers Create a readlist in each popover's head when the reader can create", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(8)],
		});

		assert.equal(
			popover(doc, "more")
				.querySelector('[data-test-action="new-readlist-in-more"]')
				?.getAttribute("popovertarget"),
			READLIST_CREATE_POPOVER_ID,
		);
		assert.equal(
			popover(doc, "sheet")
				.querySelector('[data-test-action="new-readlist-in-sheet"]')
				?.getAttribute("popovertarget"),
			READLIST_CREATE_POPOVER_ID,
		);
	});

	it("offers the limit form in each popover's head when the reader is at the readlist limit", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(8)],
			canCreate: false,
		});

		assert.equal(
			popover(doc, "more").querySelector(
				'[data-test-action="new-readlist-in-more"]',
			),
			null,
		);
		const limit = popover(doc, "more").querySelector(
			'[data-test-form="readlist-limit-in-more"]',
		);
		assert.equal(limit?.getAttribute("action"), "/queue");
		assert.equal(
			popover(doc, "sheet")
				.querySelector('[data-test-action="readlist-limit-in-sheet"]')
				?.closest("form")
				?.getAttribute("action"),
			"/queue",
		);
	});

	it("shows the create lock in each popover's head and locked menus without pin forms when the reader cannot edit", () => {
		const doc = renderNav({
			readlists: [DEFAULT_READLIST, ...namedReadlists(8)],
			canEdit: false,
			canCreate: false,
			offer: OFFER,
		});

		assert.ok(
			popover(doc, "more").querySelector('[data-test-menu-standing="locked"]'),
		);
		assert.ok(
			popover(doc, "more").querySelector(
				".readlist-more__head [popovertarget='subscribe-plans']",
			),
		);
		assert.equal(doc.querySelector('[data-test-form="readlist-pin"]'), null);
	});
});
