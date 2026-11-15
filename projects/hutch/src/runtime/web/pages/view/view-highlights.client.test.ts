import assert from "node:assert/strict";
import { calculateReadTime } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { articleBody } from "@packages/test-fixtures";
import { generateCspNonce } from "@packages/web-shell";
import { type DOMWindow, JSDOM } from "jsdom";
import { Base } from "../../base.component";
import { initHighlightToolbar } from "../../shared/article-body/highlights/highlight-toolbar.client";
import type { LocalHighlightStorage } from "../../shared/article-body/highlights/local-highlights";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../../shared/article-body/reader-slot/section-pages";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import { initViewHighlights } from "./view-highlights.client";
import { ViewPage, type ViewPageInput } from "./view.component";

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
};

const PAGE_HTML = Base(ViewPage(viewInput), {
	isAuthenticated: false,
	emailVerified: undefined,
	cspNonce: generateCspNonce(),
})
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

interface Harness {
	doc: Document;
	window: DOMWindow;
	shownPopovers: Element[];
	hiddenPopovers: Element[];
	scrolledTo: Element[];
	beacons: string[];
}

function harness(input: { storage: LocalHighlightStorage; supportsPopover?: boolean; withToolbarScript?: boolean }): Harness {
	const dom = new JSDOM(PAGE_HTML);
	const h: Harness = {
		doc: dom.window.document,
		window: dom.window,
		shownPopovers: [],
		hiddenPopovers: [],
		scrolledTo: [],
		beacons: [],
	};
	let counter = 0;
	initViewHighlights({
		document: h.doc,
		storage: input.storage,
		now: () => new Date(Date.parse("2026-11-14T10:00:00.000Z") + counter * 1000),
		newId: () => `local-${++counter}`,
		supportsPopover: () => input.supportsPopover ?? true,
		showPopover: (panel) => h.shownPopovers.push(panel),
		hidePopover: (panel) => h.hiddenPopovers.push(panel),
		scrollIntoView: (element) => h.scrolledTo.push(element),
		sendBeacon: (url) => h.beacons.push(url),
	});
	if (input.withToolbarScript) {
		initHighlightToolbar({
			document: h.doc,
			window: {
				visualViewport: { width: 1000, height: 800, offsetLeft: 0, offsetTop: 0, addEventListener: () => undefined },
				requestAnimationFrame: () => undefined,
				matchMedia: () => ({ matches: false }),
				addEventListener: () => undefined,
			},
			timers: { setTimeout: () => undefined, clearTimeout: () => undefined },
			rectsOf: () => [],
			isPopoverOpen: () => false,
			supportsPopover: () => true,
			showPopover: (panel) => h.shownPopovers.push(panel),
			hidePopover: (panel) => h.hiddenPopovers.push(panel),
			isFocusVisible: () => false,
			sendBeacon: (url) => h.beacons.push(url),
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
		const [popupField] = keptFields(h);
		assert.deepEqual(
			Array.isArray(popupField) ? popupField.map((item) => Reflect.get(Object(item), "exact")) : [],
			FIVE_QUOTES,
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
			storage: mapStorage(),
			now: () => new Date(0),
			newId: () => "local-1",
			supportsPopover: () => true,
			showPopover: () => undefined,
			hidePopover: () => undefined,
			scrollIntoView: () => undefined,
			sendBeacon: (url) => beacons.push(url),
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
					storage: mapStorage(),
					now: () => new Date(0),
					newId: () => "local-1",
					supportsPopover: () => true,
					showPopover: () => undefined,
					hidePopover: () => undefined,
					scrollIntoView: () => undefined,
					sendBeacon: () => undefined,
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

	it("sends the opened beacon of a click on a kept mark to the public event route", () => {
		const h = harness({ storage: mapStorage(), withToolbarScript: true });
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
});
