import assert from "node:assert/strict";
import { calculateReadTime } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { articleBody } from "@packages/test-fixtures";
import { generateCspNonce } from "@packages/web-shell";
import { type DOMWindow, JSDOM } from "jsdom";
import { Base } from "../../base.component";
import { HIGHLIGHTS_RENDERED_EVENT } from "../../shared/article-body/highlights/highlights-rendered-event";
import type { HighlightClipboard } from "../../shared/article-body/highlights/highlight-copy.client";
import { initHighlightToolbar, type ToolbarRect } from "../../shared/article-body/highlights/highlight-toolbar.client";
import type { LocalHighlightStorage } from "../../shared/article-body/highlights/local-highlights";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../../shared/article-body/reader-slot/section-pages";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import { ViewPage, type ViewPageInput } from "./view.component";
import { initViewHighlights } from "./view-highlights.client";

const ARTICLE_URL = "https://example.com/post";

const ARTICLE_HTML =
	"<p>The first paragraph opens the article. A second sentence follows it.</p><p>Another paragraph has several words. It closes the article.</p>";

const viewInput: ViewPageInput = {
	readerSection: { requested: undefined, readerPath: "/view/example.com/post", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES },
	now: new Date("2026-11-14T10:00:00.000Z"),
	articleUrl: ARTICLE_URL,
	destinationUrl: destinationUrl(ARTICLE_URL),
	appOrigin: "http://localhost:3000",
	metadata: { title: "Hello World", siteName: siteLabel("example.com"), excerpt: "A lovely article.", wordCount: 20 },
	estimatedReadTime: calculateReadTime(20),
	saveTip: { state: "due", html: "" },
	content: articleBody(ARTICLE_HTML),
	summary: { status: "skipped" },
	actions: [],
	backLink: undefined,
	endCta: undefined,
	offersLocalHighlights: true,
	signedIn: false,
};

const PAGE_HTML = Base(ViewPage(viewInput), {
	isAuthenticated: false,
	emailVerified: undefined,
	cspNonce: generateCspNonce(),
})
	.to("text/html")
	.body;

const PAGE_URL = "http://localhost:3000/view/example.com/post";

const OTHER_ARTICLE_URL = "https://other.example.org/essay";

const OTHER_PAGE_HTML = Base(
	ViewPage({ ...viewInput, articleUrl: OTHER_ARTICLE_URL, destinationUrl: destinationUrl(OTHER_ARTICLE_URL) }),
	{ isAuthenticated: false, emailVerified: undefined, cspNonce: generateCspNonce() },
)
	.to("text/html")
	.body;

function mapStorage(): LocalHighlightStorage {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
}

function tooLongShown(h: { doc: Document }): boolean[] {
	return Array.from(h.doc.querySelectorAll<HTMLElement>("[data-view-highlights-too-long]"), (sentence) => !sentence.hidden);
}

interface Harness {
	doc: Document;
	window: DOMWindow;
	shownPopovers: Element[];
	hiddenPopovers: Element[];
	scrolledTo: Element[];
	beacons: string[];
	submitted: { action: string; fields: Record<string, string>; intent: string }[];
}

function harness(input: {
	storage: LocalHighlightStorage;
	supportsPopover?: boolean;
	withToolbarScript?: boolean;
	rectsOf?: () => readonly ToolbarRect[];
	pageHtml?: string;
	clipboard?: HighlightClipboard;
}): Harness {
	const dom = new JSDOM(input.pageHtml ?? PAGE_HTML, { url: PAGE_URL });
	const h: Harness = {
		doc: dom.window.document,
		window: dom.window,
		shownPopovers: [],
		hiddenPopovers: [],
		scrolledTo: [],
		beacons: [],
		submitted: [],
	};
	let counter = 0;
	initViewHighlights({
		document: h.doc,
		window: { Event: dom.window.Event },
		storage: input.storage,
		now: () => new Date(Date.parse("2026-11-14T10:00:00.000Z") + counter * 1000),
		newId: () => `local-${++counter}`,
		supportsPopover: () => input.supportsPopover ?? true,
		showPopover: (panel) => h.shownPopovers.push(panel),
		hidePopover: (panel) => h.hiddenPopovers.push(panel),
		scrollIntoView: (element) => h.scrolledTo.push(element),
		sendBeacon: (url) => h.beacons.push(url),
		submitForm: ({ form, submitter }) =>
			h.submitted.push({
				action: new URL(form.action).pathname,
				fields: Object.fromEntries(
					Array.from(form.querySelectorAll<HTMLInputElement>("input[name]"), (field) => [field.name, field.value]),
				),
				intent: submitter.getAttribute("value") ?? "",
			}),
	});
	if (input.withToolbarScript) {
		initHighlightToolbar({
			document: h.doc,
			window: {
				visualViewport: { width: 1000, height: 800, offsetLeft: 0, offsetTop: 0, addEventListener: () => undefined },
				requestAnimationFrame: () => undefined,
				matchMedia: () => ({ matches: false }),
				addEventListener: () => undefined,
				scrollBy: () => undefined,
			},
			timers: { setTimeout: () => undefined, clearTimeout: () => undefined },
			rectsOf: input.rectsOf ?? (() => []),
			isPopoverOpen: () => false,
			supportsPopover: () => true,
			showPopover: (panel) => h.shownPopovers.push(panel),
			hidePopover: (panel) => h.hiddenPopovers.push(panel),
			isOpen: () => false,
			isFocusVisible: () => false,
			sendBeacon: (url) => h.beacons.push(url),
			clipboard: input.clipboard,
			isAutoPopoverOpen: () => false,
			paintDraft: () => undefined,
			clearDraft: () => undefined,
			paintPending: () => false,
			clearPending: () => undefined,
			fetchReader: async () => ({ ok: false, html: "" }),
			parseHtml: () => {
			throw new Error("these tests never check a highlight");
		},
			chromeBottom: () => 0,
		});
	}
	return h;
}

function contentOf(h: Harness): Element {
	const content = h.doc.querySelector(".article-body__content");
	assert(content, "the view page renders the article body");
	return content;
}

function fill(input: { form: Element; values: Record<string, string> }): void {
	for (const [name, value] of Object.entries(input.values)) {
		const field = input.form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
		assert(field, `the form carries its ${name} field`);
		field.value = value;
	}
}

function submit(input: { h: Harness; form: Element }): boolean {
	return input.form.dispatchEvent(new input.h.window.Event("submit", { bubbles: true, cancelable: true }));
}

function passageFields(input: { h: Harness; quote: string }): Record<string, string> {
	const { text } = normaliseText(collectTextChunks<Node>(contentOf(input.h)));
	const start = text.indexOf(input.quote);
	assert.ok(start >= 0, `the article contains "${input.quote}"`);
	return { exact: input.quote, start: String(start), end: String(start + input.quote.length), origin: "mouse" };
}

function highlight(input: { h: Harness; quote: string }): boolean {
	const form = input.h.doc.querySelector("[data-highlight-create-form]");
	assert(form, "the local toolbar renders its create form");
	fill({ form, values: passageFields(input) });
	return submit({ h: input.h, form });
}

function markedText(h: Harness): string[] {
	return Array.from(contentOf(h).querySelectorAll("mark[data-highlight-id]"), (mark) => mark.textContent ?? "");
}

function cardOf(h: Harness): HTMLElement {
	const card = h.doc.querySelector<HTMLElement>("[data-test-view-highlights]");
	assert(card, "the view page renders the highlights card");
	return card;
}

function rowsOf(h: Harness): string[] {
	return Array.from(
		cardOf(h).querySelectorAll("[data-test-view-highlight-row] [data-view-highlight-exact]"),
		(exact) => exact.textContent ?? "",
	);
}

function keptFields(h: Harness): unknown[] {
	return Array.from(h.doc.querySelectorAll<HTMLInputElement>('input[name="highlights"]'), (field) =>
		JSON.parse(field.value),
	);
}

function elsewhereRowsOf(h: Harness): { exact: string; source: string }[] {
	return Array.from(cardOf(h).querySelectorAll("[data-test-view-highlight-elsewhere-row]"), (row) => ({
		exact: row.querySelector("[data-view-highlight-exact]")?.textContent ?? "",
		source: row.querySelector("[data-view-highlight-source]")?.textContent ?? "",
	}));
}

function elsewhereOf(h: Harness): HTMLElement {
	const elsewhere = h.doc.querySelector<HTMLElement>("[data-test-view-highlights-elsewhere]");
	assert(elsewhere, "the card renders the list of highlights kept on other articles");
	return elsewhere;
}

const FIVE_QUOTES = ["The first", "paragraph opens", "A second sentence", "Another paragraph", "several words"];

describe("initViewHighlights", () => {
	it("keeps a highlighted passage in the browser, marks it and lists it in the card", () => {
		const h = harness({ storage: mapStorage() });
		assert.equal(cardOf(h).hidden, true);

		const allowed = highlight({ h, quote: "A second sentence" });

		assert.equal(allowed, false, "the local form never submits");
		assert.deepEqual(markedText(h), ["A second sentence"]);
		assert.equal(contentOf(h).querySelector("mark")?.id, "highlight-local-1");
		assert.equal(cardOf(h).hidden, false);
		assert.deepEqual(rowsOf(h), ["A second sentence"]);
		assert.deepEqual(h.beacons, ["/view/highlights/event?action=kept"]);
	});

	it("marks the kept passages again on the next page load", () => {
		const storage = mapStorage();
		highlight({ h: harness({ storage }), quote: "A second sentence" });

		const reloaded = harness({ storage });

		assert.deepEqual(markedText(reloaded), ["A second sentence"]);
		assert.deepEqual(rowsOf(reloaded), ["A second sentence"]);
	});

	it("keeps a note added through the note dialog and closes the dialog", () => {
		const h = harness({ storage: mapStorage() });
		const form = h.doc.querySelector("#note-highlight-dialog form");
		assert(form, "the local note dialog renders its form");
		fill({ form, values: { ...passageFields({ h, quote: "Another paragraph" }), note: "Worth keeping" } });

		submit({ h, form });

		const note = cardOf(h).querySelector("[data-view-highlight-note]");
		assert(note, "the row renders its note line");
		assert.equal(note.textContent, "Worth keeping");
		assert.deepEqual(
			h.hiddenPopovers.map((panel) => panel.id),
			["note-highlight-dialog"],
		);
		assert.deepEqual(
			Array.from(contentOf(h).querySelectorAll("mark"), (mark) => mark.className).at(-1),
			"article-highlight article-highlight--has-note article-highlight--note-end",
		);
	});

	it("changes a kept highlight's note from its row", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });
		const form = cardOf(h).querySelector("[data-view-highlight-note-form]");
		assert(form, "the row renders its note form");

		fill({ form, values: { note: "Row note" } });
		submit({ h, form });

		const note = cardOf(h).querySelector("[data-view-highlight-note]");
		assert.equal(note?.textContent, "Row note");
		const label = cardOf(h).querySelector<HTMLLabelElement>("[data-view-highlight-note-input-label]");
		assert.equal(label?.htmlFor, "view-highlight-note-local-1");
	});

	it("removes the mark and the row when a kept highlight is deleted", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });
		const remove = cardOf(h).querySelector<HTMLButtonElement>("[data-view-highlight-delete]");
		assert(remove, "the row renders its delete control");

		remove.click();

		assert.deepEqual(markedText(h), []);
		assert.deepEqual(rowsOf(h), []);
		assert.equal(cardOf(h).hidden, true);
		assert.equal(contentOf(h).textContent, "The first paragraph opens the article. A second sentence follows it.Another paragraph has several words. It closes the article.");
	});

	it("stores nothing past the limit and opens the sign-up popup holding the kept highlights", () => {
		const h = harness({ storage: mapStorage() });
		for (const quote of FIVE_QUOTES) highlight({ h, quote });

		highlight({ h, quote: "It closes" });

		assert.deepEqual(rowsOf(h), FIVE_QUOTES);
		assert.deepEqual(
			h.shownPopovers.map((panel) => panel.id),
			["view-highlights-keep"],
		);
		assert.equal(h.beacons.at(-1), "/view/highlights/event?action=limit-reached");
		assert.deepEqual(tooLongShown(h), [false, false]);
		const [popupField] = keptFields(h);
		assert.deepEqual(
			Array.isArray(popupField) ? popupField.map((item) => Reflect.get(Object(item), "exact")) : [],
			FIVE_QUOTES,
		);
	});

	it("lists the highlights kept on other articles so a visitor at the limit can free a slot", () => {
		const storage = mapStorage();
		const other = harness({ storage, pageHtml: OTHER_PAGE_HTML });
		for (const quote of FIVE_QUOTES) highlight({ h: other, quote });
		const h = harness({ storage });

		assert.equal(cardOf(h).hidden, false);
		assert.equal(elsewhereOf(h).hidden, false);
		assert.deepEqual(rowsOf(h), []);
		assert.deepEqual(
			elsewhereRowsOf(h),
			FIVE_QUOTES.map((exact) => ({ exact, source: "other.example.org" })),
		);
		const remove = elsewhereOf(h).querySelector<HTMLButtonElement>("[data-view-highlight-delete]");
		assert(remove, "a row kept on another article renders its delete control");
		remove.click();
		highlight({ h, quote: "It closes" });

		assert.deepEqual(rowsOf(h), ["It closes"]);
		assert.deepEqual(
			elsewhereRowsOf(h).map((row) => row.exact),
			FIVE_QUOTES.slice(1),
		);
		assert.deepEqual(h.shownPopovers, []);
	});

	it("hides the other-articles list when every kept highlight is on this article", () => {
		const h = harness({ storage: mapStorage() });

		highlight({ h, quote: "A second sentence" });

		assert.equal(elsewhereOf(h).hidden, true);
		assert.deepEqual(elsewhereRowsOf(h), []);
	});

	it("shows the card holding the in-flow form when a too-long selection is refused before anything is kept", () => {
		const h = harness({ storage: mapStorage(), supportsPopover: false });
		const form = h.doc.querySelector("[data-highlight-create-form]");
		assert(form, "the local toolbar renders its create form");
		contentOf(h).insertAdjacentHTML("beforeend", `<p>${"word ".repeat(300)}</p>`);
		const longer = normaliseText(collectTextChunks<Node>(contentOf(h))).text;
		fill({ form, values: { exact: longer, start: "0", end: String(longer.length), origin: "mouse" } });

		submit({ h, form });

		assert.equal(cardOf(h).hidden, false);
		assert.deepEqual(
			h.scrolledTo.map((element) => element.id),
			["view-highlights-keep-inline"],
		);
	});

	it("sends the kept highlights without the offsets the server never trusts", () => {
		const h = harness({ storage: mapStorage() });

		highlight({ h, quote: "A second sentence" });

		assert.deepEqual(keptFields(h)[0], [
			{
				url: ARTICLE_URL,
				exact: "A second sentence",
				prefix: "paragraph opens the article. ",
				suffix: " follows it.\nAnother paragraph",
			},
		]);
	});

	it("scrolls to the in-flow form at the limit where popovers are unsupported", () => {
		const h = harness({ storage: mapStorage(), supportsPopover: false });
		for (const quote of FIVE_QUOTES) highlight({ h, quote });

		highlight({ h, quote: "It closes" });

		assert.deepEqual(h.shownPopovers, []);
		assert.deepEqual(
			h.scrolledTo.map((element) => element.id),
			["view-highlights-keep-inline"],
		);
	});

	it("opens the popup for a selection longer than the browser may keep", () => {
		const h = harness({ storage: mapStorage() });
		const form = h.doc.querySelector("[data-highlight-create-form]");
		assert(form, "the local toolbar renders its create form");
		const longText = "word ".repeat(300);
		contentOf(h).insertAdjacentHTML("beforeend", `<p>${longText}</p>`);
		const longer = normaliseText(collectTextChunks<Node>(contentOf(h))).text;
		fill({ form, values: { exact: longer, start: "0", end: String(longer.length), origin: "mouse" } });

		submit({ h, form });

		assert.deepEqual(rowsOf(h), []);
		assert.deepEqual(
			h.shownPopovers.map((panel) => panel.id),
			["view-highlights-keep"],
		);
		assert.deepEqual(tooLongShown(h), [true, true]);
	});

	it("drops the too-long sentence when the popup is opened from the card's button", () => {
		const h = harness({ storage: mapStorage() });
		const form = h.doc.querySelector("[data-highlight-create-form]");
		assert(form, "the local toolbar renders its create form");
		contentOf(h).insertAdjacentHTML("beforeend", `<p>${"word ".repeat(300)}</p>`);
		const longer = normaliseText(collectTextChunks<Node>(contentOf(h))).text;
		fill({ form, values: { exact: longer, start: "0", end: String(longer.length), origin: "mouse" } });
		submit({ h, form });
		const trigger = h.doc.querySelector<HTMLButtonElement>("[data-view-highlights-keep-trigger]");
		assert(trigger, "the card renders its create-account button");

		trigger.click();

		assert.deepEqual(tooLongShown(h), [false, false]);
	});

	it("hides the too-long sentence until a passage or note is refused for its length", () => {
		const h = harness({ storage: mapStorage() });

		highlight({ h, quote: "A second sentence" });

		assert.deepEqual(tooLongShown(h), [false, false]);
	});

	it("ignores a submitted passage that no longer matches the article", () => {
		const h = harness({ storage: mapStorage() });
		const form = h.doc.querySelector("[data-highlight-create-form]");
		assert(form, "the local toolbar renders its create form");
		fill({ form, values: { exact: "Not in the article", start: "0", end: "18", origin: "mouse" } });

		submit({ h, form });

		assert.deepEqual(rowsOf(h), []);
		assert.deepEqual(h.beacons, []);
	});

	it("removes the toolbar when a write fails after the browser said it could keep highlights", () => {
		const storage = mapStorage();
		const h = harness({ storage });
		storage.setItem = () => {
			throw new Error("QuotaExceededError");
		};

		highlight({ h, quote: "A second sentence" });

		assert.equal(h.doc.querySelectorAll("[data-highlight-toolbar]").length, 0);
		assert.deepEqual(rowsOf(h), []);
	});

	it("keeps nothing for an empty passage", () => {
		const h = harness({ storage: mapStorage() });
		const form = h.doc.querySelector("[data-highlight-create-form]");
		assert(form, "the local toolbar renders its create form");
		fill({ form, values: { exact: "", start: "4", end: "4", origin: "mouse" } });

		submit({ h, form });

		assert.deepEqual(rowsOf(h), []);
		assert.deepEqual(h.shownPopovers, []);
	});

	it("opens the popup for a row note longer than the browser may keep", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });
		const form = cardOf(h).querySelector("[data-view-highlight-note-form]");
		assert(form, "the row renders its note form");

		fill({ form, values: { note: "n".repeat(1001) } });
		submit({ h, form });

		assert.equal(cardOf(h).querySelector("[data-view-highlight-note]")?.textContent, "");
		assert.deepEqual(
			h.shownPopovers.map((panel) => panel.id),
			["view-highlights-keep"],
		);
		assert.deepEqual(tooLongShown(h), [true, true]);
	});

	it("lists a kept highlight whose passage is gone last, marked as not found, with no Jump", () => {
		const storage = mapStorage();
		const h = harness({ storage });
		highlight({ h, quote: "A second sentence" });
		const kept = storage.getItem("readplace.view-highlights");
		assert(kept, "the first highlight is kept");
		const stored = JSON.parse(kept);
		stored.items.unshift({ ...stored.items[0], id: "gone", exact: "A passage edited out", prefix: "", suffix: "" });
		storage.setItem("readplace.view-highlights", JSON.stringify(stored));

		const reloaded = harness({ storage });

		assert.deepEqual(rowsOf(reloaded), ["A second sentence", "A passage edited out"]);
		const rows = Array.from(cardOf(reloaded).querySelectorAll<HTMLElement>("[data-test-view-highlight-row]"));
		assert.deepEqual(
			rows.map((row) => [
				row.querySelector<HTMLElement>("[data-view-highlight-orphan]")?.hidden,
				row.querySelector<HTMLElement>("[data-view-highlight-jump]")?.hidden,
			]),
			[
				[true, false],
				[false, true],
			],
		);
	});

	it("does nothing on a page that offers no local highlights", () => {
		const dom = new JSDOM("<!doctype html><html><body><main><p>Signed-in view</p></main></body></html>");
		const beacons: string[] = [];

		initViewHighlights({
			document: dom.window.document,
			window: { Event: dom.window.Event },
			storage: mapStorage(),
			now: () => new Date(0),
			newId: () => "local-1",
			supportsPopover: () => true,
			showPopover: () => undefined,
			hidePopover: () => undefined,
			scrollIntoView: () => undefined,
			sendBeacon: (url) => beacons.push(url),
			submitForm: () => undefined,
		});

		assert.equal(dom.window.document.body.innerHTML, "<main><p>Signed-in view</p></main>");
		assert.deepEqual(beacons, []);
	});

	it("refuses to start on markup missing a part it needs", () => {
		const dom = new JSDOM(PAGE_HTML);
		dom.window.document.querySelector("[data-view-highlights-list]")?.remove();

		assert.throws(
			() =>
				initViewHighlights({
					document: dom.window.document,
					window: { Event: dom.window.Event },
					storage: mapStorage(),
					now: () => new Date(0),
					newId: () => "local-1",
					supportsPopover: () => true,
					showPopover: () => undefined,
					hidePopover: () => undefined,
					scrollIntoView: () => undefined,
					sendBeacon: () => undefined,
					submitForm: () => undefined,
				}),
			/the view highlights markup carries \[data-view-highlights-list\]/,
		);
	});

	it("ignores submits and clicks that do not come from an element", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });

		h.doc.dispatchEvent(new h.window.Event("submit", { bubbles: true, cancelable: true }));
		h.doc.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true }));

		assert.deepEqual(rowsOf(h), ["A second sentence"]);
	});

	it("removes the toolbar when the browser cannot keep a highlight", () => {
		const h = harness({
			storage: {
				getItem: () => null,
				setItem: () => {
					throw new Error("QuotaExceededError");
				},
				removeItem: () => undefined,
			},
		});

		assert.equal(h.doc.querySelectorAll("[data-highlight-toolbar]").length, 0);
		assert.equal(cardOf(h).hidden, true);
	});

	it("copies a kept row's quote filled from local storage and reports it to the public event route", async () => {
		const copied: string[] = [];
		const h = harness({
			storage: mapStorage(),
			withToolbarScript: true,
			rectsOf: () => [{ top: 100, bottom: 120, left: 100, width: 200 }],
			clipboard: { writeText: async (text) => void copied.push(text) },
		});
		highlight({ h, quote: "A second sentence" });
		h.beacons.length = 0;
		const copy = cardOf(h).querySelector<HTMLElement>("[data-test-view-highlight-row] [data-test-action='highlight-copy']");
		assert(copy, "each kept row renders a Copy button");

		copy.click();
		await Promise.resolve();

		assert.deepEqual(copied, ["A second sentence"]);
		assert.equal(h.doc.documentElement.classList.contains("has-clipboard"), true);
		assert.equal(h.doc.querySelector("[data-test-highlight-copy-status]")?.textContent, "Highlight copied");
		assert.deepEqual(h.beacons, ["/view/highlights/event?action=copied"]);
	});

	it("sends the opened beacon of a click on a kept mark to the public event route", () => {
		const h = harness({
			storage: mapStorage(),
			withToolbarScript: true,
			rectsOf: () => [{ top: 100, bottom: 120, left: 100, width: 200 }],
		});
		highlight({ h, quote: "A second sentence" });
		const mark = contentOf(h).querySelector<HTMLElement>("mark[data-highlight-id]");
		assert(mark, "the kept passage is marked");

		mark.click();

		assert.equal(h.beacons.at(-1), "/view/highlights/event?highlight=local-1&origin=mark");
	});

	it("marks the kept passages again after htmx settles a swap", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });
		contentOf(h).innerHTML = "<p>The first paragraph opens the article. A second sentence follows it.</p>";

		h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle"));

		assert.deepEqual(markedText(h), ["A second sentence"]);
	});

	function addToPage(input: { h: Harness; html: string }): Element {
		const holder = input.h.doc.createElement("div");
		holder.innerHTML = input.html;
		input.h.doc.body.append(holder);
		const element = holder.firstElementChild;
		assert(element, "the added markup holds an element");
		return element;
	}

	function click(input: { h: Harness; element: Element }): boolean {
		return input.element.dispatchEvent(new input.h.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	}

	it("hands the kept highlights over before the Save button sends the visitor to sign up, returning to the save", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });
		const save = addToPage({ h, html: '<a href="/save?url=https%3A%2F%2Fexample.com%2Fpost&amp;surface=reader-view">Save</a>' });

		const followed = click({ h, element: save });

		assert.equal(followed, false, "the Save link does not navigate");
		assert.deepEqual(
			h.submitted.map(({ action, fields, intent }) => ({ action, article: fields.article, return: fields.return, intent })),
			[
				{
					action: "/view/highlights/keep",
					article: ARTICLE_URL,
					return: "/save?url=https%3A%2F%2Fexample.com%2Fpost&surface=reader-view",
					intent: "signup",
				},
			],
		);
		assert.deepEqual(
			h.submitted.map(({ fields }) => JSON.parse(fields.highlights ?? "[]").map((item: { exact: string }) => item.exact)),
			[["A second sentence"]],
		);
	});

	it("hands the kept highlights over before the end-of-article Save form sends the visitor to sign up", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });
		const form = addToPage({
			h,
			html: '<form method="GET" action="/save"><input type="hidden" name="url" value="https://example.com/post"></form>',
		});

		const allowed = submit({ h, form });

		assert.equal(allowed, false, "the Save form does not submit");
		assert.deepEqual(
			h.submitted.map(({ fields, intent }) => [fields.return, intent]),
			[["/save?url=https%3A%2F%2Fexample.com%2Fpost", "signup"]],
		);
	});

	it("hands the kept highlights over before a log-in or sign-up link, keeping the page that link returns to", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });
		const login = addToPage({ h, html: '<a href="/login">Log in</a>' });
		const signup = addToPage({ h, html: '<a href="/signup?return=%2Finbox"><span>Sign up</span></a>' });

		click({ h, element: login });
		const label = signup.querySelector("span");
		assert(label, "the sign-up link holds its label");
		click({ h, element: label });

		assert.deepEqual(
			h.submitted.map(({ fields, intent }) => [fields.return, intent]),
			[
				["", "login"],
				["/inbox", "signup"],
			],
		);
	});

	it("lets the Save button, the Save form and other links through while the browser keeps no highlight", () => {
		const h = harness({ storage: mapStorage() });
		const save = addToPage({ h, html: '<a href="/save?url=https%3A%2F%2Fexample.com%2Fpost">Save</a>' });
		const form = addToPage({ h, html: '<form method="GET" action="/save"></form>' });

		assert.deepEqual([click({ h, element: save }), submit({ h, form })], [true, true]);
		assert.deepEqual(h.submitted, []);
	});

	it("lets links and forms that do not lead to sign-up through while highlights are kept", () => {
		const h = harness({ storage: mapStorage() });
		highlight({ h, quote: "A second sentence" });
		const elsewhere = addToPage({ h, html: '<a href="https://other.example/login">Log in elsewhere</a>' });
		const top = addToPage({ h, html: '<a href="#top">Top</a>' });
		const search = addToPage({ h, html: '<form method="get" action="/search"><input name="q" value="x"></form>' });

		assert.deepEqual([click({ h, element: elsewhere }), click({ h, element: top }), submit({ h, form: search })], [
			true,
			true,
			true,
		]);
		assert.deepEqual(h.submitted, []);
		assert.deepEqual(rowsOf(h), ["A second sentence"]);
	});
});

describe("initViewHighlights — the actions on a kept passage", () => {
	const PASSAGE_RECTS: readonly ToolbarRect[] = [{ top: 100, bottom: 120, left: 100, width: 200 }];

	function textHarness(storage = mapStorage()): Harness {
		return harness({ storage, withToolbarScript: true, rectsOf: () => PASSAGE_RECTS });
	}

	function byId(input: { h: Harness; id: string }): HTMLElement {
		const element = input.h.doc.getElementById(input.id);
		assert(element, `the page renders #${input.id}`);
		return element;
	}

	function part<E extends Element>(input: { root: ParentNode; selector: string }): E {
		const element = input.root.querySelector<E>(input.selector);
		assert(element, `the markup carries ${input.selector}`);
		return element;
	}

	function markOf(input: { h: Harness; id: string }): HTMLElement {
		return part<HTMLElement>({ root: contentOf(input.h), selector: `mark[data-highlight-id="${input.id}"]` });
	}

	function openPanel(input: { h: Harness; id: string }): HTMLElement {
		markOf(input).click();
		return byId({ h: input.h, id: `manage-highlight-${input.id}` });
	}

	function noteOf(input: { h: Harness; id: string }): string | undefined {
		const note = part<HTMLElement>({
			root: cardOf(input.h),
			selector: `[data-view-highlight-row="${input.id}"] [data-view-highlight-note]`,
		});
		return note.hidden ? undefined : (note.textContent ?? "");
	}

	function rowNote(input: { h: Harness; quote: string; note: string }): void {
		highlight(input);
		const forms = cardOf(input.h).querySelectorAll("[data-view-highlight-note-form]");
		const form = forms[forms.length - 1];
		assert(form, "the new row renders its note form");
		fill({ form, values: { note: input.note } });
		submit({ h: input.h, form });
	}

	function focusedId(h: Harness): string | null {
		return h.doc.activeElement?.getAttribute("data-highlight-id") ?? null;
	}

	it("gives each kept passage its preview, actions panel, note editor and delete confirm", () => {
		const h = textHarness();
		highlight({ h, quote: "The first" });
		rowNote({ h, quote: "A second sentence", note: "Kept <b>note</b>" });

		assert.equal(h.doc.getElementById("preview-highlight-local-1"), null);
		assert.equal(byId({ h, id: "preview-highlight-local-2" }).textContent?.trim(), "Kept <b>note</b>");
		const panel = byId({ h, id: "manage-highlight-local-2" });
		assert.equal(part({ root: panel, selector: "[data-highlight-note-text]" }).textContent, "Kept <b>note</b>");
		assert.equal(panel.querySelector("[data-highlight-note-text]") !== null, true);
		assert.equal(byId({ h, id: "manage-highlight-local-1" }).querySelector("[data-highlight-note-text]"), null);
		const editor = byId({ h, id: "note-highlight-local-2" });
		assert.equal(part<HTMLTextAreaElement>({ root: editor, selector: "textarea" }).value, "Kept <b>note</b>");
		assert.equal(part<HTMLTextAreaElement>({ root: byId({ h, id: "note-highlight-local-1" }), selector: "textarea" }).value, "");
		assert.ok(byId({ h, id: "delete-highlight-local-1" }));
		assert.ok(byId({ h, id: "delete-highlight-local-2" }));
		assert.equal(cardOf(h).querySelector("[data-view-highlights-surfaces]")?.innerHTML.includes("00000000-0000-4000-8000-000000000000"), false);
		assert.equal(byId({ h, id: "manage-highlight-hint" }).hidden, true);
	});

	it("makes every kept passage a tab stop described by its note and the actions hint", () => {
		const h = textHarness();
		highlight({ h, quote: "The first" });
		rowNote({ h, quote: "A second sentence", note: "Worth it" });

		assert.deepEqual(
			["local-1", "local-2"].map((id) => {
				const mark = markOf({ h, id });
				return [mark.getAttribute("tabindex"), mark.getAttribute("aria-describedby"), mark.getAttribute("aria-controls")];
			}),
			[
				["0", "manage-highlight-hint", "manage-highlight-local-1"],
				["0", "preview-highlight-local-2 manage-highlight-hint", "manage-highlight-local-2"],
			],
		);
	});

	it("opens a passage's actions panel on a click, focusing the passage", () => {
		const h = textHarness();
		highlight({ h, quote: "A second sentence" });

		const panel = openPanel({ h, id: "local-1" });

		assert.equal(h.shownPopovers.at(-1), panel);
		assert.equal(focusedId(h), "local-1");
	});

	it("adds a note from the panel's editor and returns focus to the passage", () => {
		const h = textHarness();
		highlight({ h, quote: "A second sentence" });
		const panel = openPanel({ h, id: "local-1" });
		part<HTMLElement>({ root: panel, selector: '[data-test-action="highlight-panel-note"]' }).click();
		const editor = byId({ h, id: "note-highlight-local-1" });
		const form = part({ root: editor, selector: 'form[data-highlight-local="note"]' });
		fill({ form, values: { note: "Added in the text" } });

		const allowed = submit({ h, form });

		assert.equal(allowed, false);
		assert.equal(noteOf({ h, id: "local-1" }), "Added in the text");
		assert.equal(byId({ h, id: "preview-highlight-local-1" }).textContent?.trim(), "Added in the text");
		assert.ok(h.hiddenPopovers.includes(editor));
		assert.equal(focusedId(h), "local-1");
		assert.equal(h.doc.activeElement, markOf({ h, id: "local-1" }));
	});

	it("edits a note from the editor, which opens holding the note", () => {
		const h = textHarness();
		rowNote({ h, quote: "A second sentence", note: "First thought" });
		const form = part<HTMLFormElement>({ root: byId({ h, id: "note-highlight-local-1" }), selector: "form" });
		assert.equal(part<HTMLTextAreaElement>({ root: form, selector: "textarea" }).value, "First thought");

		fill({ form, values: { note: "Second thought" } });
		submit({ h, form });

		assert.equal(noteOf({ h, id: "local-1" }), "Second thought");
	});

	it("deletes a note from the panel and returns focus to the passage", () => {
		const h = textHarness();
		rowNote({ h, quote: "A second sentence", note: "Short-lived" });
		const panel = openPanel({ h, id: "local-1" });

		part<HTMLElement>({ root: panel, selector: '[data-test-action="highlight-panel-note-delete"]' }).click();

		assert.equal(noteOf({ h, id: "local-1" }), undefined);
		assert.equal(h.doc.getElementById("preview-highlight-local-1"), null);
		assert.equal(focusedId(h), "local-1");
	});

	it("deletes a note from the editor's Delete note button", () => {
		const h = textHarness();
		rowNote({ h, quote: "A second sentence", note: "Short-lived" });
		const editor = byId({ h, id: "note-highlight-local-1" });

		part<HTMLElement>({ root: editor, selector: '[data-test-action="highlight-note-delete"]' }).click();

		assert.equal(noteOf({ h, id: "local-1" }), undefined);
	});

	it("deletes a note from its row, whose Delete note shows only while there is a note", () => {
		const h = textHarness();
		rowNote({ h, quote: "A second sentence", note: "Short-lived" });
		const form = part<HTMLFormElement>({ root: cardOf(h), selector: 'form[data-highlight-local="delete-note"]' });
		assert.equal(form.hidden, false);

		const allowed = submit({ h, form });

		assert.equal(allowed, false);
		assert.equal(noteOf({ h, id: "local-1" }), undefined);
		assert.equal(part<HTMLFormElement>({ root: cardOf(h), selector: 'form[data-highlight-local="delete-note"]' }).hidden, true);
	});

	it("deletes a passage through its confirm and moves focus to the next passage", () => {
		const h = textHarness();
		highlight({ h, quote: "The first" });
		highlight({ h, quote: "A second sentence" });
		const panel = openPanel({ h, id: "local-1" });
		part<HTMLElement>({ root: panel, selector: '[data-test-action="highlight-panel-delete"]' }).click();
		const confirm = byId({ h, id: "delete-highlight-local-1" });

		const allowed = submit({ h, form: part({ root: confirm, selector: 'form[data-highlight-local="delete"]' }) });

		assert.equal(allowed, false);
		assert.deepEqual(markedText(h), ["A second sentence"]);
		assert.deepEqual(rowsOf(h), ["A second sentence"]);
		assert.ok(h.hiddenPopovers.includes(confirm));
		assert.equal(h.doc.getElementById("delete-highlight-local-1"), null);
		assert.equal(focusedId(h), "local-2");
	});

	it("asks before deleting from the list, on this article and on other articles", () => {
		const storage = mapStorage();
		highlight({ h: harness({ storage, pageHtml: OTHER_PAGE_HTML }), quote: "The first" });
		storage.setItem("readplace.view-highlights", (storage.getItem("readplace.view-highlights") ?? "").replace("local-1", "elsewhere-1"));
		const h = textHarness(storage);
		highlight({ h, quote: "A second sentence" });

		const triggers = Array.from(
			cardOf(h).querySelectorAll('[data-test-action="view-highlight-delete-confirm"]'),
			(trigger) => trigger.getAttribute("popovertarget"),
		);

		assert.deepEqual(triggers, ["delete-highlight-local-1", "delete-highlight-elsewhere-1"]);
		assert.equal(h.doc.getElementById("manage-highlight-elsewhere-1"), null);
		submit({ h, form: part({ root: byId({ h, id: "delete-highlight-elsewhere-1" }), selector: "form" }) });
		assert.deepEqual(elsewhereRowsOf(h), []);
		assert.deepEqual(rowsOf(h), ["A second sentence"]);
	});

	it("gives a passage not found in this version only its delete confirm", () => {
		const storage = mapStorage();
		highlight({ h: harness({ storage }), quote: "A second sentence" });
		const kept = storage.getItem("readplace.view-highlights");
		assert(kept, "the highlight is kept");
		storage.setItem("readplace.view-highlights", kept.replace('"exact":"A second sentence"', '"exact":"A passage edited out"'));

		const h = textHarness(storage);

		assert.equal(h.doc.getElementById("manage-highlight-local-1"), null);
		assert.equal(h.doc.getElementById("note-highlight-local-1"), null);
		assert.ok(byId({ h, id: "delete-highlight-local-1" }));
	});

	it("opens the popup for an editor note longer than the browser may keep and still restores focus", () => {
		const h = textHarness();
		highlight({ h, quote: "A second sentence" });
		let rendered = 0;
		h.doc.addEventListener(HIGHLIGHTS_RENDERED_EVENT, () => {
			rendered += 1;
		});
		const form = part({ root: byId({ h, id: "note-highlight-local-1" }), selector: "form" });
		fill({ form, values: { note: "n".repeat(1001) } });

		submit({ h, form });

		assert.equal(noteOf({ h, id: "local-1" }), undefined);
		assert.equal(h.shownPopovers.at(-1)?.id, "view-highlights-keep");
		assert.deepEqual(tooLongShown(h), [true, true]);
		assert.equal(rendered, 1);
	});

	it("keeps text typed into a row's note form through a poll that changed nothing", () => {
		const h = textHarness();
		highlight({ h, quote: "A second sentence" });
		const input = part<HTMLTextAreaElement>({ root: cardOf(h), selector: "[data-view-highlight-note-input]" });
		input.value = "Half-typed";

		h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle"));

		assert.equal(part<HTMLTextAreaElement>({ root: cardOf(h), selector: "[data-view-highlight-note-input]" }), input);
		assert.equal(input.value, "Half-typed");
	});

	it("marks the passages again after a settle that dropped the marks from the same text", () => {
		const h = textHarness();
		highlight({ h, quote: "A second sentence" });
		const content = contentOf(h);
		content.innerHTML = content.innerHTML.replace(/<mark[^>]*>|<\/mark>/g, "");
		assert.deepEqual(markedText(h), []);

		h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle"));

		assert.deepEqual(markedText(h), ["A second sentence"]);
	});

	it("redraws after a settle when another tab changed the kept highlights", () => {
		const storage = mapStorage();
		const h = textHarness(storage);
		highlight({ h, quote: "A second sentence" });
		highlight({ h: harness({ storage }), quote: "The first" });

		h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle"));

		assert.deepEqual(rowsOf(h), ["The first", "A second sentence"]);
	});

	it("ignores a form that names an action the page does not run", () => {
		const h = textHarness();
		highlight({ h, quote: "A second sentence" });
		const form = h.doc.createElement("form");
		form.setAttribute("data-highlight-local", "share");
		h.doc.body.append(form);

		assert.equal(submit({ h, form }), true);
		assert.deepEqual(rowsOf(h), ["A second sentence"]);
	});
});
