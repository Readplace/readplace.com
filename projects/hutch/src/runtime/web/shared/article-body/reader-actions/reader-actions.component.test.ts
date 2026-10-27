import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { type IconName, iconSvg } from "@packages/ui-icons";
import {
	type ActionButtons,
	ChromelessReader,
	RegularReader,
	WebReader,
	renderReaderDownloadsOob,
	renderReaderDownloadsSlotOob,
} from "./reader-actions.component";
import { epubDownloadGuideFor } from "../../epub/epub-download-guide";

const BACK = {
	topHref: "/queue?utm_content=back-top",
	bottomHref: "/queue?utm_content=back-bottom",
	label: "Back to readlist",
};

const ACTION_BTNS = {
	readlistPicker: undefined,
	backLink: BACK,
	markReadActions: [
		{
			position: "top",
			postUrl: "/queue/abc/status?utm_content=mark-read-top",
			label: "Mark as read",
			iconName: "check",
			testAction: "mark-read",
			fields: [{ name: "status", value: "read" }],
		},
		{
			position: "bottom",
			postUrl: "/queue/abc/status?utm_content=mark-read-bottom",
			label: "Mark as read",
			iconName: "check",
			testAction: "mark-read",
			fields: [{ name: "status", value: "read" }],
		},
	],
} satisfies ActionButtons;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function drawingOf(svg: Element | null | undefined): string | undefined {
	return svg?.querySelector("path")?.getAttribute("d") ?? undefined;
}

function iconDrawing(name: IconName): string | undefined {
	return drawingOf(parse(iconSvg(name)).querySelector("svg"));
}

const CREATE = {
	createUrl: "/queue/abc/create-and-assign",
	maxLength: 24,
	popoverId: "reader-readlist-create",
	nameLabel: "Readlist name",
	namePlaceholder: "Enter readlist name",
};

describe("readlist picker", () => {
	it("renders one assign form per offered readlist inside an anchored disclosure", () => {
		const { top } = WebReader({
			actionBtns: {
				...ACTION_BTNS,
				readlistPicker: {
					assignUrl: "/queue/abc/assign",
					returnTo: "/queue/abc/view",
					options: [
						{ slug: ReadlistSlugSchema.parse("work"), label: "Work", iconName: "folder" },
						{ slug: ReadlistSlugSchema.parse("later"), label: "Later", iconName: "file" },
					],
					create: undefined,
				},
			},
		});
		const doc = parse(top.to("text/html").body);

		const slot = doc.querySelector("[data-test-readlists-slot]");
		assert(slot, "the readlists slot must render");
		expect(slot.classList.contains("article-body__readlists-slot--visible")).toBe(true);
		assert(doc.querySelector("[data-test-readlists-trigger]"), "the trigger must render");
		const forms = Array.from(doc.querySelectorAll(".article-body__readlists-form"));
		expect(forms.map((form) => form.getAttribute("action"))).toEqual([
			"/queue/abc/assign",
			"/queue/abc/assign",
		]);
		expect(
			forms.map((form) => form.querySelector('input[name="queue"]')?.getAttribute("value")),
		).toEqual(["work", "later"]);
		expect(
			forms.map((form) => form.querySelector('input[name="returnTo"]')?.getAttribute("value")),
		).toEqual(["/queue/abc/view", "/queue/abc/view"]);
		expect(
			Array.from(doc.querySelectorAll("[data-test-assign-readlist]"), (el) => el.textContent),
		).toEqual(["Work", "Later"]);
		expect(
			Array.from(
				doc.querySelectorAll("[data-test-assign-readlist] .article-body__readlists-option-label"),
				(el) => el.textContent,
			),
		).toEqual(["Work", "Later"]);
		expect(
			Array.from(doc.querySelectorAll("[data-test-assign-readlist]"), (el) =>
				drawingOf(el.querySelector(":scope > svg")),
			),
		).toEqual([iconDrawing("folder"), iconDrawing("file")]);
		expect(
			Array.from(doc.querySelectorAll("[data-test-readlists-row]"), (el) =>
				el.getAttribute("data-test-readlists-row"),
			),
		).toEqual(["work", "later"]);
	});

	it("opens from a neutral Add to readlist trigger that leads with its plus", () => {
		const { top } = WebReader({
			actionBtns: {
				...ACTION_BTNS,
				readlistPicker: {
					assignUrl: "/queue/abc/assign",
					returnTo: "/queue/abc/view",
					options: [{ slug: ReadlistSlugSchema.parse("work"), label: "Work", iconName: "folder" }],
					create: undefined,
				},
			},
		});
		const doc = parse(top.to("text/html").body);

		const trigger = doc.querySelector("[data-test-readlists-trigger]");
		assert(trigger, "the trigger must render");
		expect(trigger.className).toBe("btn btn--neutral article-body__readlists-trigger");
		expect(drawingOf(trigger.querySelector(":scope > svg"))).toBe(iconDrawing("plus"));
		expect(trigger.querySelector(".article-body__action-label")?.textContent).toBe("Add to readlist");
		expect(drawingOf(trigger.querySelector(".article-body__readlists-chevron svg"))).toBe(
			iconDrawing("chevron-down"),
		);
	});

	it("ends with a create row that opens the naming dialog, over a plain-form fallback", () => {
		const { top } = WebReader({
			actionBtns: {
				...ACTION_BTNS,
				readlistPicker: {
					assignUrl: "/queue/abc/assign",
					returnTo: "/queue/abc/view",
					options: [{ slug: ReadlistSlugSchema.parse("work"), label: "Work", iconName: "folder" }],
					create: CREATE,
				},
			},
		});
		const doc = parse(top.to("text/html").body);

		expect(
			Array.from(doc.querySelectorAll("[data-test-readlists-row]"), (el) =>
				el.getAttribute("data-test-readlists-row"),
			),
		).toEqual(["work", "create"]);

		const opener = doc.querySelector('[data-test-action="readlist-create-open"]');
		assert(opener, "the create row must carry the dialog's trigger");
		expect(opener.getAttribute("type")).toBe("button");
		expect(opener.getAttribute("popovertarget")).toBe("reader-readlist-create");
		expect(opener.getAttribute("aria-haspopup")).toBe("dialog");
		expect(opener.textContent).toBe("Create a readlist");
		expect(drawingOf(opener.querySelector(":scope > svg"))).toBe(iconDrawing("plus"));

		const createForm = doc.querySelector('[data-test-readlists-row="create"] form');
		assert(createForm, "the create row must keep its plain form for engines without popover");
		expect(createForm.className).toBe("article-body__readlists-create article-body__readlists-create-fallback");
		expect(Array.from(createForm.attributes, (attribute) => attribute.name)).toEqual([
			"class",
			"method",
			"action",
			"hx-boost",
		]);
		expect(createForm.getAttribute("action")).toBe("/queue/abc/create-and-assign");
		expect(createForm.getAttribute("hx-boost")).toBe("false");
		expect(createForm.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
			"/queue/abc/view",
		);

		const nameInput = doc.querySelector("[data-test-readlist-create-name]");
		assert(nameInput, "the create row must carry its name input");
		expect(nameInput.className).toBe("form-input");
		expect(nameInput.getAttribute("name")).toBe("label");
		expect(nameInput.hasAttribute("required")).toBe(true);
		expect(nameInput.getAttribute("maxlength")).toBe("24");
		expect(nameInput.getAttribute("aria-label")).toBe("Readlist name");
		expect(nameInput.getAttribute("placeholder")).toBe("Enter readlist name");

		const submit = doc.querySelector('[data-test-action="readlist-create-assign"]');
		assert(submit, "the create row must carry its submit button");
		expect(submit.getAttribute("type")).toBe("submit");
	});

	it("keeps the slot in the bar, hidden, when there is nothing to offer", () => {
		const { top } = WebReader({ actionBtns: ACTION_BTNS });
		const doc = parse(top.to("text/html").body);

		const slot = doc.querySelector("[data-test-readlists-slot]");
		assert(slot, "the readlists slot must render");
		expect(slot.classList.contains("article-body__readlists-slot--hidden")).toBe(true);
	});
});

describe("downloads", () => {
	it("renders one direct EPUB link, not a disclosure, when a download is offered", () => {
		const { top } = WebReader({
			actionBtns: { ...ACTION_BTNS, epubDownloadHref: "/view/example.com/a?format=epub" },
		});
		const doc = parse(top.to("text/html").body);

		const slot = doc.querySelector("[data-test-downloads-slot]");
		assert(slot, "the downloads slot must render");
		expect(slot.classList.contains("article-body__downloads-slot--visible")).toBe(true);
		const download = doc.querySelector("[data-test-download]");
		assert(download, "the download link must render");
		expect(download.tagName).toBe("A");
		expect(download.getAttribute("data-test-download")).toBe("epub");
		expect(download.getAttribute("href")).toBe("/view/example.com/a?format=epub");
		expect(download.className).toBe("btn btn--neutral btn--icon article-body__download");
		expect(download.querySelector(".sr-only")?.textContent).toBe("Download EPUB");
		expect(drawingOf(download.querySelector(":scope > svg"))).toBe(iconDrawing("download"));
		expect(doc.querySelectorAll("[data-test-download]")).toHaveLength(1);
	});

	it("keeps the slot in the bar, hidden, when no downloads are offered", () => {
		const { top } = WebReader({ actionBtns: ACTION_BTNS });
		const doc = parse(top.to("text/html").body);

		const slot = doc.querySelector("[data-test-downloads-slot]");
		assert(slot, "the downloads slot must render");
		expect(slot.classList.contains("article-body__downloads-slot--hidden")).toBe(true);
	});

	it("swaps the toolbar's slot out of band with the link a page hands it", () => {
		const doc = parse(renderReaderDownloadsSlotOob({ downloadHref: "/view/example.com/a?format=epub&utm_source=view-article", guide: undefined, placements: ["toolbar"] }));

		const slot = doc.querySelector("[data-test-downloads-slot]");
		assert(slot, "the out-of-band downloads slot must render");
		expect([slot.id, slot.classList.contains("article-body__downloads-slot--visible"), slot.getAttribute("hx-swap-oob")]).toEqual([
			"reader-downloads-slot",
			true,
			"outerHTML",
		]);
		const download = slot.querySelector('[data-test-download="epub"]');
		assert(download, "the out-of-band slot must carry the EPUB link");
		expect(download.getAttribute("href")).toBe("/view/example.com/a?format=epub&utm_source=view-article");
	});

	it("links the owner reader's out-of-band download from the reader's own section", () => {
		const doc = parse(renderReaderDownloadsOob({ articleUrl: "https://example.com/a", appClient: undefined, guide: undefined }));

		const download = doc.querySelector('#reader-downloads-slot [data-test-download="epub"]');
		assert(download, "the owner reader's out-of-band slot must carry the EPUB link");
		const href = new URL(download.getAttribute("href") ?? "", "http://localhost");
		expect([href.pathname, href.searchParams.get("format"), href.searchParams.get("utm_source")]).toEqual([
			"/view/example.com/a",
			"epub",
			"reader",
		]);
	});
});

describe("downloads on a platform with no EPUB reader", () => {
	const DOWNLOAD_HREF = "/view/example.com/a?format=epub&utm_source=reader";
	const LEARN_MORE_HREF = "/blog/read-your-saved-articles-on-a-kindle-or-kobo?utm_source=reader";
	const WINDOWS_GUIDE = epubDownloadGuideFor({
		osFamily: "windows",
		downloadHref: DOWNLOAD_HREF,
		learnMoreHref: LEARN_MORE_HREF,
	});

	function gatedSlot(): Element {
		const { top } = WebReader({
			actionBtns: { ...ACTION_BTNS, epubDownloadHref: DOWNLOAD_HREF, epubDownloadGuide: WINDOWS_GUIDE },
		});
		const slot = parse(top.to("text/html").body).querySelector("[data-test-downloads-slot]");
		assert(slot, "the downloads slot must render");
		return slot;
	}

	it("opens the guide from the same square download button, beside a disclosure holding the same guide", () => {
		const slot = gatedSlot();

		expect(slot.classList.contains("article-body__downloads-slot--visible")).toBe(true);
		expect(Array.from(slot.children, (child) => child.tagName)).toEqual(["BUTTON", "DETAILS"]);
		const opener = slot.querySelector('[data-test-action="download-open"]');
		assert(opener, "the slot must open the guide");
		expect([
			opener.className,
			opener.getAttribute("popovertarget"),
			opener.getAttribute("aria-haspopup"),
			opener.querySelector(".sr-only")?.textContent,
		]).toEqual(["btn btn--neutral btn--icon article-body__download-open", "reader-download-guide", "dialog", "Download EPUB"]);
		expect(drawingOf(opener.querySelector(":scope > svg"))).toBe(iconDrawing("download"));
		expect([opener, slot.querySelector("summary")].map((control) => control?.hasAttribute("aria-disabled"))).toEqual([
			false,
			false,
		]);
	});

	it("holds the reader app, the Kindle and Kobo guide and one download in the no-popover fallback", () => {
		const slot = gatedSlot();

		const fallback = slot.querySelector("[data-test-download-fallback]");
		assert(fallback, "the slot must carry the fallback disclosure");
		const readerApp = fallback.querySelector("[data-test-download-reader-app]");
		assert(readerApp, "the fallback must link the reader app");
		expect([readerApp.getAttribute("href"), readerApp.getAttribute("target"), readerApp.getAttribute("rel")]).toEqual([
			"https://apps.microsoft.com/detail/9NFZP1G7M2SC",
			"_blank",
			"noopener",
		]);
		expect(fallback.querySelector("[data-test-download-learn-more]")?.getAttribute("href")).toBe(LEARN_MORE_HREF);
		const downloads = Array.from(fallback.querySelectorAll('[data-test-download="epub-fallback"]'));
		expect(downloads.map((download) => [download.getAttribute("href"), download.hasAttribute("autofocus")])).toEqual([
			[DOWNLOAD_HREF, false],
		]);
	});

	it("keeps the gated slot hidden until the article has content to download", () => {
		const { top } = WebReader({ actionBtns: { ...ACTION_BTNS, epubDownloadGuide: WINDOWS_GUIDE } });
		const slot = parse(top.to("text/html").body).querySelector("[data-test-downloads-slot]");
		assert(slot, "the downloads slot must render");

		expect([slot.classList.contains("article-body__downloads-slot--hidden"), slot.children.length]).toEqual([true, 0]);
	});

	it("swaps the gated slot in out of band with no id inside it", () => {
		const doc = parse(
			renderReaderDownloadsOob({ articleUrl: "https://example.com/a", appClient: undefined, guide: WINDOWS_GUIDE }),
		);

		const slot = doc.querySelector("#reader-downloads-slot");
		assert(slot, "the out-of-band slot must render");
		expect([
			slot.getAttribute("hx-swap-oob"),
			slot.querySelector('[data-test-action="download-open"]')?.getAttribute("popovertarget"),
			slot.querySelectorAll("[id]").length,
		]).toEqual(["outerHTML", "reader-download-guide", 0]);
	});
});

describe("toolbar order", () => {
	const FULL_ACTION_BTNS = {
		...ACTION_BTNS,
		readlistPicker: {
			assignUrl: "/queue/abc/assign",
			returnTo: "/queue/abc/view",
			options: [{ slug: ReadlistSlugSchema.parse("work"), label: "Work", iconName: "folder" }],
			create: undefined,
		},
		share: { popoverId: "reader-share", fallbackHtml: '<p class="share-fixture">The share panel</p>' },
		epubDownloadHref: "/view/example.com/a?format=epub",
	} satisfies ActionButtons;

	function topBarOf(actionBtns: ActionButtons): Document {
		return parse(WebReader({ actionBtns }).top.to("text/html").body);
	}

	function slotsOf(doc: Document): string[] {
		return Array.from(doc.querySelectorAll(".article-body__actions--top > *"), (slot) => {
			const hook = Array.from(slot.attributes, (attribute) => attribute.name).find((name) =>
				name.startsWith("data-test-") && name.endsWith("-slot"),
			);
			assert(hook, "every toolbar slot carries its test hook");
			return hook.slice("data-test-".length, -"-slot".length);
		});
	}

	it("reads back, then Add, Mark, Share and Download", () => {
		expect(slotsOf(topBarOf(FULL_ACTION_BTNS))).toEqual(["back", "readlists", "mark-read", "share", "downloads"]);
	});

	it("renders no share slot for a bar built without share", () => {
		expect(slotsOf(topBarOf({ ...FULL_ACTION_BTNS, share: undefined }))).toEqual([
			"back",
			"readlists",
			"mark-read",
			"downloads",
		]);
	});

	it("keeps Share and Download in their places when sharing is withheld", () => {
		const { share: _share, epubDownloadHref: _epubDownloadHref, ...rest } = FULL_ACTION_BTNS;
		expect(
			slotsOf(topBarOf({ ...rest, withheld: { popoverId: "reader-sharing-off", fallbackHtml: "<p>Off</p>" } })),
		).toEqual(["back", "readlists", "mark-read", "share", "downloads"]);
	});

	it("opens Share from a square icon button, beside a disclosure holding the same panel", () => {
		const doc = topBarOf(FULL_ACTION_BTNS);

		const opener = doc.querySelector('[data-test-action="share-open"]');
		assert(opener, "the share control must render");
		expect(opener.className).toBe("btn btn--neutral btn--icon article-body__share");
		expect(opener.getAttribute("type")).toBe("button");
		expect(opener.getAttribute("popovertarget")).toBe("reader-share");
		expect(opener.getAttribute("aria-haspopup")).toBe("dialog");
		expect(opener.querySelector(".sr-only")?.textContent).toBe("Share");
		expect(drawingOf(opener.querySelector(":scope > svg"))).toBe(iconDrawing("share"));
		expect(opener.hasAttribute("aria-disabled")).toBe(false);

		const fallback = doc.querySelector("[data-test-share-fallback]");
		assert(fallback, "the share slot must keep a disclosure for engines without popover");
		expect(fallback.tagName).toBe("DETAILS");
		expect(fallback.querySelector("summary")?.className).toBe("btn btn--neutral btn--icon");
		expect(fallback.querySelector("summary .sr-only")?.textContent).toBe("Share");
		expect(fallback.querySelector("summary")?.hasAttribute("aria-disabled")).toBe(false);
		expect(fallback.querySelector(".article-body__share-fallback-panel")?.innerHTML).toBe(
			'<p class="share-fixture">The share panel</p>',
		);
	});

	it("draws Mark as a secondary button whose icon follows the direction it marks in", () => {
		const markRead = topBarOf(FULL_ACTION_BTNS).querySelector("[data-test-mark-read-btn]");
		assert(markRead, "the mark-read button must render");
		expect(markRead.className).toBe("btn btn--secondary article-body__mark-read");
		expect(drawingOf(markRead.querySelector(".article-body__mark-read-icon svg"))).toBe(iconDrawing("check"));

		const markUnread = topBarOf({
			...FULL_ACTION_BTNS,
			markReadActions: [
				{
					position: "top",
					postUrl: "/queue/abc/status?utm_content=mark-unread-top",
					label: "Mark as unread",
					iconName: "inbox",
					testAction: "mark-unread",
					fields: [{ name: "status", value: "unread" }],
				},
			],
		}).querySelector("[data-test-mark-read-btn]");
		assert(markUnread, "the mark-unread button must render");
		expect(drawingOf(markUnread.querySelector(".article-body__mark-read-icon svg"))).toBe(iconDrawing("inbox"));
	});

	it("keeps every control's full name in the document so the accessible name survives the compact row", () => {
		const doc = topBarOf(FULL_ACTION_BTNS);

		expect(
			["[data-test-back-link]", "[data-test-readlists-trigger]", "[data-test-mark-read-btn]"].map(
				(selector) => doc.querySelector(`${selector} .article-body__action-label`)?.textContent,
			),
		).toEqual(["Back to readlist", "Add to readlist", "Mark as read"]);
		expect(
			['[data-test-action="share-open"]', "[data-test-download]"].map(
				(selector) => doc.querySelector(`${selector} .sr-only`)?.textContent,
			),
		).toEqual(["Share", "Download EPUB"]);
	});
});

describe("withheld sharing", () => {
	const WITHHELD_BTNS = {
		readlistPicker: undefined,
		backLink: BACK,
		withheld: { popoverId: "reader-sharing-off", fallbackHtml: '<p class="sharing-off-fixture">Sharing is off</p>' },
	} satisfies ActionButtons;

	it.each([
		["RegularReader", RegularReader],
		["WebReader", WebReader],
		["ChromelessReader", ChromelessReader],
	])("dims Share and Download in the %s, both opening the dialog that says why", (_name, renderActions) => {
		const doc = parse(renderActions({ actionBtns: WITHHELD_BTNS }).top.to("text/html").body);

		const triggers = Array.from(
			doc.querySelectorAll('[data-test-action="share-withheld"], [data-test-action="download-withheld"]'),
		);
		expect(
			triggers.map((trigger) => [
				trigger.tagName,
				trigger.className,
				trigger.getAttribute("type"),
				trigger.getAttribute("popovertarget"),
				trigger.getAttribute("aria-haspopup"),
				trigger.getAttribute("aria-disabled"),
				trigger.hasAttribute("disabled"),
				trigger.querySelector(".sr-only")?.textContent,
			]),
		).toEqual([
			["BUTTON", "btn btn--neutral btn--icon article-body__share", "button", "reader-sharing-off", "dialog", "true", false, "Share"],
			[
				"BUTTON",
				"btn btn--neutral btn--icon article-body__download-open",
				"button",
				"reader-sharing-off",
				"dialog",
				"true",
				false,
				"Download EPUB",
			],
		]);
		expect(
			Array.from(doc.querySelectorAll("[data-test-share-fallback], [data-test-download-fallback]"), (fallback) => [
				fallback.querySelector("summary")?.getAttribute("aria-disabled"),
				fallback.querySelector(".sharing-off-fixture")?.textContent,
			]),
		).toEqual([
			["true", "Sharing is off"],
			["true", "Sharing is off"],
		]);
	});

	it("dims Share and Download in the menu too, ahead of Delete, both opening the dialog that says why", () => {
		const doc = parse(
			WebReader({
				actionBtns: { ...WITHHELD_BTNS, menu: { deleteItemsHtml: '<button class="menu__item">Delete</button>' } },
			}).top.to("text/html").body,
		);

		const panel = doc.querySelector("[data-test-reader-menu-panel]");
		assert(panel, "the menu panel must render");
		expect(
			Array.from(panel.querySelectorAll(":scope > *"), (item) => [
				item.className,
				item.querySelector(".article-body__menu-popover-item")?.getAttribute("data-test-action"),
				item.querySelector(".article-body__menu-popover-item")?.getAttribute("popovertarget"),
				item.querySelector(".article-body__menu-popover-item")?.getAttribute("aria-disabled"),
				item.querySelector("summary")?.getAttribute("aria-disabled"),
				item.querySelector(".sharing-off-fixture")?.textContent,
			]),
		).toEqual([
			[
				"article-body__menu-slot article-body__menu-slot--visible",
				"menu-share-withheld",
				"reader-sharing-off",
				"true",
				"true",
				"Sharing is off",
			],
			[
				"article-body__menu-slot article-body__menu-slot--visible",
				"menu-download-withheld",
				"reader-sharing-off",
				"true",
				"true",
				"Sharing is off",
			],
			["menu__item", undefined, undefined, undefined, undefined, undefined],
		]);
		expect(panel.querySelectorAll("a, #reader-menu-download-epub").length).toBe(0);
	});

	it("shows the downloads slot with no EPUB link in it", () => {
		const doc = parse(WebReader({ actionBtns: WITHHELD_BTNS }).top.to("text/html").body);

		const slot = doc.querySelector("[data-test-downloads-slot]");
		assert(slot, "the downloads slot must render");
		expect([
			slot.classList.contains("article-body__downloads-slot--visible"),
			slot.querySelectorAll("a").length,
			doc.querySelectorAll("#reader-download-epub").length,
		]).toEqual([true, 0, 0]);
	});
});

describe("mark-read confirmation", () => {
	it("keeps one plain form, holding the action's own test hook, when nothing needs confirming", () => {
		const { top } = WebReader({ actionBtns: ACTION_BTNS });
		const doc = parse(top.to("text/html").body);

		const button = doc.querySelector("[data-test-mark-read-btn]");
		assert(button, "the mark-read button must render");
		expect(button.getAttribute("data-test-action")).toBe("mark-read");
		expect(button.getAttribute("type")).toBe("submit");
		expect(doc.querySelectorAll(".article-body__confirm-trigger")).toHaveLength(0);
		expect(doc.querySelectorAll(".article-body__mark-read-fallback")).toHaveLength(0);
	});

	it("splits into a popover trigger and a renamed fallback once the action is confirmed", () => {
		const { top } = WebReader({
			actionBtns: {
				...ACTION_BTNS,
				markReadActions: [
					{
						position: "top",
						postUrl: "/queue/abc/status?utm_content=mark-read-top",
						label: "Mark as read",
						iconName: "check",
						testAction: "mark-read",
						fields: [{ name: "status", value: "read" }],
						confirmPopoverId: "readlist-mark-status-confirm-abc",
					},
				],
			},
		});
		const doc = parse(top.to("text/html").body);

		const trigger = doc.querySelector(".article-body__confirm-trigger");
		assert(trigger, "the popover trigger must render");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("readlist-mark-status-confirm-abc");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("data-test-action")).toBe("mark-read");
		expect(trigger.getAttribute("aria-label")).toBe("Mark as read");
		expect(trigger.closest("form")).toBeNull();

		const fallback = doc.querySelector("[data-test-mark-read-btn]");
		assert(fallback, "the plain form must stay behind for browsers without popover support");
		expect(fallback.getAttribute("data-test-action")).toBe("mark-read-fallback");
		expect(fallback.closest("form")?.classList.contains("article-body__mark-read-fallback")).toBe(
			true,
		);
	});
});

describe("RegularReader", () => {
	it("renders inline top and bottom bars with back links and mark-read forms", () => {
		const { top, bottom } = RegularReader({ actionBtns: ACTION_BTNS });
		const topDoc = parse(top.to("text/html").body);
		const bottomDoc = parse(bottom.to("text/html").body);

		const toolbar = topDoc.querySelector(".article-body__toolbar");
		assert(toolbar, "the toolbar row must wrap the top bar, as on every reader");
		assert(toolbar.querySelector(".article-body__actions--top"), "top bar must render inside the toolbar row");

		const backSlot = topDoc.querySelector("[data-test-back-slot]");
		assert(backSlot, "top back slot must render");
		expect(backSlot.classList.contains("article-body__back-slot--visible")).toBe(true);
		expect(topDoc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe(BACK.topHref);

		const form = topDoc.querySelector("[data-test-mark-read-form]");
		assert(form, "top mark-read form must render");
		expect(form.getAttribute("action")).toBe("/queue/abc/status?utm_content=mark-read-top");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");

		// In flight the visible label is visibility:hidden (dropped from the a11y
		// tree) and the loader is aria-hidden, so aria-label keeps the button named
		// while it is disabled — parity with the readlist and toast mark-read controls.
		expect(topDoc.querySelector("[data-test-mark-read-btn]")?.getAttribute("aria-label")).toBe(
			"Mark as read",
		);
		expect(
			bottomDoc.querySelector("[data-test-mark-read-bottom-btn]")?.getAttribute("aria-label"),
		).toBe("Mark as read");

		expect(bottomDoc.querySelector("[data-test-back-bottom-link]")?.getAttribute("href")).toBe(
			BACK.bottomHref,
		);
		const bottomForm = bottomDoc.querySelector("[data-test-mark-read-bottom-form]");
		assert(bottomForm, "bottom mark-read form must render");
		expect(bottomForm.getAttribute("action")).toBe("/queue/abc/status?utm_content=mark-read-bottom");
	});

	it("renders hidden slots when given no action buttons (ViewPage/AdminRecrawl parity)", () => {
		const { top, bottom } = RegularReader({ actionBtns: { readlistPicker: undefined } });
		const topDoc = parse(top.to("text/html").body);
		const bottomDoc = parse(bottom.to("text/html").body);

		expect(
			topDoc.querySelector("[data-test-back-slot]")?.classList.contains("article-body__back-slot--hidden"),
		).toBe(true);
		expect(
			topDoc
				.querySelector("[data-test-mark-read-slot]")
				?.classList.contains("article-body__mark-read-slot--hidden"),
		).toBe(true);
		expect(
			bottomDoc
				.querySelector("[data-test-back-bottom-slot]")
				?.classList.contains("article-body__back-bottom-slot--hidden"),
		).toBe(true);
		expect(
			bottomDoc
				.querySelector("[data-test-mark-read-bottom-slot]")
				?.classList.contains("article-body__mark-read-slot--hidden"),
		).toBe(true);
	});

	it("carries the distraction-free page body class (no chromeless offset)", () => {
		expect(RegularReader({ actionBtns: ACTION_BTNS }).bodyClass).toBe("page-reader page-distraction-free");
	});
});

describe("WebReader", () => {
	it("places the top action buttons inside the toolbar row, keeping the mark-read form", () => {
		const { top } = WebReader({ actionBtns: ACTION_BTNS });
		const topDoc = parse(top.to("text/html").body);

		const toolbar = topDoc.querySelector(".article-body__toolbar");
		assert(toolbar, "the toolbar row must wrap the top action buttons");
		assert(
			toolbar.querySelector(".article-body__actions--top"),
			"the top action bar must live inside the toolbar row",
		);
		expect(topDoc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe(BACK.topHref);
		assert(topDoc.querySelector("[data-test-mark-read-form]"), "the web reader keeps the top mark-read form");
	});

	it("drops the entire bottom bar — the toolbar row carries the article's actions", () => {
		const { bottom } = WebReader({ actionBtns: ACTION_BTNS });
		expect(bottom.to("text/html").body).toBe("");
	});

	it("carries the distraction-free page body class so the shell hides its chrome", () => {
		expect(WebReader({ actionBtns: ACTION_BTNS }).bodyClass).toBe("page-reader page-distraction-free");
	});
});

describe("ChromelessReader", () => {
	it("places the top action buttons inside the toolbar row, keeping the mark-read form", () => {
		const { top } = ChromelessReader({ actionBtns: ACTION_BTNS });
		const topDoc = parse(top.to("text/html").body);

		const toolbar = topDoc.querySelector(".article-body__toolbar");
		assert(toolbar, "the toolbar row must wrap the top action buttons");
		assert(
			toolbar.querySelector(".article-body__actions--top"),
			"the top action bar must live inside the toolbar row",
		);
		expect(topDoc.querySelector("[data-test-back-link]")?.getAttribute("href")).toBe(BACK.topHref);
		assert(topDoc.querySelector("[data-test-mark-read-form]"), "chromeless keeps the top mark-read form");
	});

	it("drops the entire bottom bar — the native sheet handles dismissal", () => {
		const { bottom } = ChromelessReader({ actionBtns: ACTION_BTNS });
		expect(bottom.to("text/html").body).toBe("");
	});

	it("carries the chromeless body class so the reader CSS pins the toolbar row at the top", () => {
		expect(ChromelessReader({ actionBtns: ACTION_BTNS }).bodyClass).toBe(
			"page-reader page-reader--chromeless",
		);
	});
});
