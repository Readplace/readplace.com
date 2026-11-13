import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { articleBody } from "@packages/test-fixtures";
import { type DOMWindow, JSDOM } from "jsdom";
import { renderHighlightsRail } from "../highlights-rail/highlights-rail.component";
import { renderReaderReady } from "../reader-slot/reader-ready.component";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../reader-slot/section-pages";
import {
	HIGHLIGHT_SELECTION_EVENT,
	initHighlightToolbar,
	POINTER_SETTLE_MS,
	SELECTION_DEBOUNCE_MS,
	type ToolbarRect,
} from "./highlight-toolbar.client";
import {
	renderHighlightNoteCreateForm,
	renderHighlightNoteEditDialog,
	renderHighlightNoteFallbackForm,
} from "./highlight-note-dialog.component";
import {
	ARTICLE_HIGHLIGHT_CLASS,
	HIGHLIGHT_NOTE_CREATE_HIDDEN_FIELDS,
	renderHighlightToolbar,
} from "./highlight-toolbar.component";

const READER_SECTION = { requested: undefined, readerPath: "/queue/abc/view", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES };
const READER_URL = "https://example.com/post";
const APP_ORIGIN = "https://readplace.com";
const HIGHLIGHT_ID = HighlightIdSchema.parse("11111111-1111-4111-8111-111111111111");
const CONTENT = "<p>😀 Alpha beta gamma.</p><p>Delta <em>epsilon</em> zeta.</p>";
const TOOLBAR_SIZE = { width: 120, height: 44 };

function railHtml(): string {
	const row: Highlight = {
		highlightId: HIGHLIGHT_ID,
		highlightOf: READER_URL,
		exact: "beta",
		prefix: "",
		suffix: "",
		start: 9,
		end: 13,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: 0,
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
	};
	return renderHighlightsRail({
		rows: [{ highlight: row, state: "anchored" }],
		scope: { articleId: "abc", readlist: [], surface: [] },
		oob: false,
	}).html;
}

function rowNoteFormsHtml(): string {
	const scope = { articleId: "abc", readlist: [], surface: [] };
	return `${renderHighlightNoteEditDialog({ highlightId: HIGHLIGHT_ID, note: "Row note", scope })}<details class="highlight-note__fallback">${renderHighlightNoteFallbackForm({ highlightId: HIGHLIGHT_ID, note: "Row note", scope })}</details>`;
}

function notedBeta(): Highlight {
	return {
		highlightId: HIGHLIGHT_ID,
		highlightOf: READER_URL,
		exact: "beta",
		prefix: "",
		suffix: "",
		start: 9,
		end: 13,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: 0,
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
		note: "A note on beta",
	};
}

function mainHtml(
	input: { content?: string; marks?: boolean; rowNoteForms?: boolean; noted?: boolean; toolbar?: boolean } = {},
): string {
	const content = input.content ?? CONTENT;
	const reader = renderReaderReady({
		readerSection: READER_SECTION,
		url: READER_URL,
		content: articleBody(content),
		appOrigin: APP_ORIGIN,
		...(input.noted ? { highlights: { rows: [notedBeta()], canonicalContentHash: "hash" } } : {}),
	}).html;
	return `<main>${input.rowNoteForms ? rowNoteFormsHtml() : ""}${input.toolbar === false ? "" : renderHighlightToolbar({ scope: { articleId: "abc", readlist: [], surface: [] } })}${reader}${input.marks ? railHtml() : ""}<p id="outside">Outside the article</p></main>`;
}

interface Harness {
	doc: Document;
	window: DOMWindow;
	runTimer(delayMs: number): void;
	pendingDelays(): number[];
	runFrames(): void;
	frameCount(): number;
	viewport: {
		width: number;
		height: number;
		offsetLeft: number;
		offsetTop: number;
		fire(type: "scroll" | "resize"): void;
	};
	coarse: boolean;
	scrollWindow(): void;
	rects: ToolbarRect[];
	submitted: HTMLFormElement[];
	popoverSupported: boolean;
	shownPopovers: Element[];
	hiddenPopovers: Element[];
	beacons: string[];
}

function harness(bodyHtml: string = mainHtml()): Harness {
	const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
	const doc = dom.window.document;
	const timers = new Map<number, { callback: () => void; delayMs: number }>();
	let nextHandle = 1;
	const frames: (() => void)[] = [];
	const viewportListeners: { type: string; listener: () => void }[] = [];
	const scrollListeners: { listener: () => void; passive: boolean }[] = [];
	const submitted: HTMLFormElement[] = [];
	dom.window.HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement) {
		submitted.push(this);
	};
	const h: Harness = {
		doc,
		window: dom.window,
		runTimer(delayMs) {
			for (const [handle, timer] of timers) {
				if (timer.delayMs !== delayMs) continue;
				timers.delete(handle);
				timer.callback();
			}
		},
		pendingDelays: () => Array.from(timers.values(), (timer) => timer.delayMs),
		runFrames() {
			for (const frame of frames.splice(0)) frame();
		},
		frameCount: () => frames.length,
		viewport: {
			width: 1000,
			height: 800,
			offsetLeft: 0,
			offsetTop: 0,
			fire(type) {
				for (const entry of viewportListeners) if (entry.type === type) entry.listener();
			},
		},
		rects: [{ top: 300, bottom: 320, left: 400, width: 200 }],
		submitted,
		popoverSupported: true,
		shownPopovers: [],
		hiddenPopovers: [],
		beacons: [],
		coarse: false,
		scrollWindow() {
			for (const entry of scrollListeners) if (entry.passive) entry.listener();
		},
	};
	initHighlightToolbar({
		document: doc,
		window: {
			visualViewport: {
				get width() {
					return h.viewport.width;
				},
				get height() {
					return h.viewport.height;
				},
				get offsetLeft() {
					return h.viewport.offsetLeft;
				},
				get offsetTop() {
					return h.viewport.offsetTop;
				},
				addEventListener: (type, listener) => viewportListeners.push({ type, listener }),
			},
			requestAnimationFrame: (callback) => frames.push(callback),
			matchMedia: (query) => ({
				matches: query === "(pointer: coarse)" ? h.coarse : query === "(hover: hover)" && !h.coarse,
			}),
			addEventListener: (_type, listener, options) => scrollListeners.push({ listener, passive: options.passive }),
		},
		timers: {
			setTimeout: (callback, delayMs) => {
				const handle = nextHandle++;
				timers.set(handle, { callback, delayMs });
				return handle;
			},
			clearTimeout: (handle) => {
				for (const key of timers.keys()) if (key === handle) timers.delete(key);
			},
		},
		rectsOf: () => h.rects,
		isPopoverOpen: () => false,
		supportsPopover: () => h.popoverSupported,
		showPopover: (panel) => h.shownPopovers.push(panel),
		hidePopover: (panel) => h.hiddenPopovers.push(panel),
		isFocusVisible: () => true,
		sendBeacon: (url) => h.beacons.push(url),
	});
	const toolbar = doc.querySelector("[data-test-highlight-toolbar]");
	if (toolbar !== null) {
		Object.defineProperty(toolbar, "getBoundingClientRect", {
			value: () => TOOLBAR_SIZE,
			configurable: true,
		});
	}
	return h;
}

function toolbarOf(h: Harness): HTMLElement {
	const toolbar = h.doc.querySelector<HTMLElement>("[data-test-highlight-toolbar]");
	assert(toolbar);
	return toolbar;
}

function contentOf(h: Harness): Element {
	const content = h.doc.querySelector(".article-body__content");
	assert(content);
	return content;
}

function textNodeContaining(input: { h: Harness; root: Node; needle: string }): Node {
	const walker = input.h.doc.createTreeWalker(input.root, input.h.window.NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node.nodeValue?.includes(input.needle)) return node;
	}
	throw new Error(`no text node holds "${input.needle}"`);
}

function pointAt(input: { h: Harness; root?: Node; needle: string; after?: boolean }): { node: Node; offset: number } {
	const node = textNodeContaining({
		h: input.h,
		root: input.root ?? contentOf(input.h),
		needle: input.needle,
	});
	const index = (node.nodeValue ?? "").indexOf(input.needle);
	return { node, offset: input.after ? index + input.needle.length : index };
}

function select(
	h: Harness,
	input: {
		from: { node: Node; offset: number };
		to: { node: Node; offset: number };
	},
): void {
	const range = h.doc.createRange();
	range.setStart(input.from.node, input.from.offset);
	range.setEnd(input.to.node, input.to.offset);
	const selection = h.doc.getSelection();
	assert(selection);
	selection.removeAllRanges();
	selection.addRange(range);
}

function selectWords(h: Harness, input: { from: string; to?: string; root?: Node }): void {
	select(h, {
		from: pointAt({ h, root: input.root, needle: input.from }),
		to: pointAt({
			h,
			root: input.root,
			needle: input.to ?? input.from,
			after: true,
		}),
	});
}

function fire(h: Harness, type: string, init: Record<string, unknown> = {}): void {
	h.doc.dispatchEvent(new h.window.Event(type, { bubbles: true, ...init }));
}

function settleSelection(h: Harness): void {
	fire(h, "selectionchange");
	h.runTimer(SELECTION_DEBOUNCE_MS);
}

function click(h: Harness, target: Element): void {
	target.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true }));
}

function buttonOf(h: Harness): Element {
	const button = h.doc.querySelector('[data-test-action="highlight"]');
	assert(button);
	return button;
}

function markWord(h: Harness, word: string): Element {
	const range = h.doc.createRange();
	const from = pointAt({ h, needle: word });
	range.setStart(from.node, from.offset);
	range.setEnd(from.node, from.offset + word.length);
	const mark = h.doc.createElement("mark");
	mark.className = ARTICLE_HIGHLIGHT_CLASS;
	mark.dataset.highlightId = HIGHLIGHT_ID;
	range.surroundContents(mark);
	return mark;
}

function formFields(form: HTMLFormElement): Record<string, string> {
	return Object.fromEntries(Array.from(form.querySelectorAll("input"), (input) => [input.name, input.value]));
}

function servedText(h: Harness): string {
	return normaliseText(collectTextChunks<Node>(contentOf(h))).text;
}

describe("initHighlightToolbar", () => {
	it("on a page without its toolbar, only the previews start", () => {
		const h = harness(mainHtml({ noted: true, toolbar: false }));
		const mark = h.doc.querySelector(`mark#highlight-${HIGHLIGHT_ID}`);
		const preview = h.doc.querySelector<HTMLElement>(`#preview-highlight-${HIGHLIGHT_ID}`);
		assert(mark && preview);
		Object.defineProperty(preview, "getBoundingClientRect", { value: () => ({ width: 100, height: 40 }) });
		const hover = new h.window.MouseEvent("pointerover", { bubbles: true });
		Object.defineProperty(hover, "pointerType", { value: "mouse" });
		Object.defineProperty(hover, "buttons", { value: 0 });

		mark.dispatchEvent(hover);
		h.runTimer(400);
		expect(h.shownPopovers).toEqual([preview]);
		click(h, mark);
		expect(preview.classList.contains("highlight-preview--pinned")).toBe(true);
		h.rects = [{ top: 500, bottom: 520, left: 400, width: 200 }];
		h.scrollWindow();
		h.runFrames();
		expect(preview.style.top).toBe(`${500 - 10 - 40}px`);

		expect(h.beacons).toEqual([]);
	});

	it("shows the bar for a selection inside the article, once the selection has rested 100 ms", () => {
		const h = harness();
		selectWords(h, { from: "beta" });

		fire(h, "selectionchange");
		expect(toolbarOf(h).hidden).toBe(true);
		h.runTimer(SELECTION_DEBOUNCE_MS);

		expect(toolbarOf(h).hidden).toBe(false);
	});

	it("restarts the debounce on every selectionchange", () => {
		const h = harness();
		selectWords(h, { from: "beta" });

		fire(h, "selectionchange");
		fire(h, "selectionchange");

		expect(h.pendingDelays()).toEqual([SELECTION_DEBOUNCE_MS]);
	});

	it.each(["pointerup", "contextmenu"])("checks the selection 10 ms after %s", (type) => {
		const h = harness();
		selectWords(h, { from: "beta" });

		fire(h, type);
		expect(h.pendingDelays()).toEqual([POINTER_SETTLE_MS]);
		h.runTimer(POINTER_SETTLE_MS);

		expect(toolbarOf(h).hidden).toBe(false);
	});

	it("hides the bar when the selection collapses", () => {
		const h = harness();
		selectWords(h, { from: "beta" });
		settleSelection(h);

		const point = pointAt({ h, needle: "beta" });
		select(h, { from: point, to: point });
		settleSelection(h);

		expect(toolbarOf(h).hidden).toBe(true);
	});

	it("leaves the bar as it is when the selection has no anchor node", () => {
		const h = harness();
		selectWords(h, { from: "beta" });
		settleSelection(h);

		h.doc.getSelection()?.removeAllRanges();
		settleSelection(h);

		expect(toolbarOf(h).hidden).toBe(false);
	});

	it("shows nothing for a selection outside the article", () => {
		const h = harness();
		const outside = h.doc.getElementById("outside");
		assert(outside);

		selectWords(h, { from: "Outside", root: outside });
		settleSelection(h);

		expect(toolbarOf(h).hidden).toBe(true);
	});

	it("hides the bar when the page holds no reader content", () => {
		const h = harness(`<main>${renderHighlightToolbar({ scope: { articleId: "abc", readlist: [], surface: [] } })}<p id="outside">Outside</p></main>`);
		const outside = h.doc.getElementById("outside");
		assert(outside);

		selectWords(h, { from: "Outside", root: outside });
		settleSelection(h);

		expect(toolbarOf(h).hidden).toBe(true);
	});

	it("fills exact, start and end in UTF-16 units of the served text, submits, and clears the selection", () => {
		const h = harness();
		selectWords(h, { from: "beta" });
		settleSelection(h);

		click(h, buttonOf(h));

		expect(h.submitted).toHaveLength(1);
		const fields = formFields(h.submitted[0]);
		const start = servedText(h).indexOf("beta");
		expect(start).toBe(9);
		expect(fields).toEqual({
			exact: "beta",
			start: String(start),
			end: String(start + 4),
			origin: "mouse",
		});
		expect(h.doc.getSelection()?.rangeCount).toBe(0);
		expect(toolbarOf(h).hidden).toBe(true);
	});

	it("keeps the range trimmed to the article when the selection runs past it", () => {
		const h = harness();
		const outside = h.doc.getElementById("outside");
		assert(outside);
		select(h, {
			from: pointAt({ h, needle: "zeta" }),
			to: pointAt({ h, root: outside, needle: "Outside", after: true }),
		});
		settleSelection(h);

		click(h, buttonOf(h));

		expect(formFields(h.submitted[0]).exact).toBe("zeta.");
	});

	it("reads one passage across an inline element and a block boundary", () => {
		const h = harness();
		selectWords(h, { from: "gamma", to: "epsilon" });
		settleSelection(h);

		click(h, buttonOf(h));

		const fields = formFields(h.submitted[0]);
		expect(fields.exact).toBe("gamma.\nDelta epsilon");
		expect(servedText(h).slice(Number(fields.start), Number(fields.end))).toBe(fields.exact);
	});

	it("submits the new form after <main> is swapped", () => {
		const h = harness();
		const main = h.doc.querySelector("main");
		assert(main);
		main.outerHTML = mainHtml();
		fire(h, "htmx:afterSettle");

		selectWords(h, { from: "zeta" });
		settleSelection(h);
		click(h, buttonOf(h));

		expect(h.submitted).toHaveLength(1);
		expect(h.submitted[0].isConnected).toBe(true);
		expect(h.submitted[0]).toBe(h.doc.querySelector("[data-test-highlight-create-form]"));
	});

	it("disables its controls in flight on both the create and the delete forms", () => {
		const h = harness(mainHtml({ marks: true }));

		const forms = Array.from(h.doc.querySelectorAll("form:not(.highlight-note-form)"));
		expect(forms.length).toBeGreaterThan(1);
		for (const form of forms) expect(form.hasAttribute("hx-disabled-elt")).toBe(true);
	});

	it("does nothing when Highlight is pressed with no selection shown", () => {
		const h = harness();

		click(h, buttonOf(h));

		expect(h.submitted).toHaveLength(0);
	});

	it.each([
		["Escape", "keydown", { key: "Escape" }, true],
		["another key", "keydown", { key: "a" }, false],
	] as const)("%s hides the bar: %s", (_label, type, init, hidden) => {
		const h = harness();
		selectWords(h, { from: "beta" });
		settleSelection(h);

		if (type === "keydown") h.doc.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: init.key, bubbles: true }));
		else fire(h, type);

		expect(toolbarOf(h).hidden).toBe(hidden);
	});

	it("keeps the bar over a live selection when an unrelated slot settles", () => {
		const h = harness();
		selectWords(h, { from: "beta" });
		settleSelection(h);

		fire(h, "htmx:afterSettle");

		expect(toolbarOf(h).hidden).toBe(false);
	});

	it("hides the bar when a settle has swapped the selected text away", () => {
		const h = harness();
		selectWords(h, { from: "beta" });
		settleSelection(h);

		const main = h.doc.querySelector("main");
		assert(main);
		main.outerHTML = mainHtml();
		fire(h, "htmx:afterSettle");

		expect(toolbarOf(h).hidden).toBe(true);
	});

	it("hides on a press outside the bar and stays open on a press inside it", () => {
		const h = harness();
		selectWords(h, { from: "beta" });
		settleSelection(h);

		buttonOf(h).dispatchEvent(new h.window.Event("pointerdown", { bubbles: true }));
		expect(toolbarOf(h).hidden).toBe(false);
		contentOf(h).dispatchEvent(new h.window.Event("pointerdown", { bubbles: true }));
		expect(toolbarOf(h).hidden).toBe(true);
	});

	it("submits the selection event's own origin", () => {
		const h = harness();
		selectWords(h, { from: "beta" });

		h.doc.dispatchEvent(
			new h.window.CustomEvent(HIGHLIGHT_SELECTION_EVENT, {
				detail: { origin: "tap" },
			}),
		);

		expect(formFields(h.submitted[0])).toEqual({
			exact: "beta",
			start: "9",
			end: "13",
			origin: "tap",
		});
	});

	it.each([
		["no detail", undefined],
		["no origin", {}],
		["a non-string origin", { origin: 1 }],
	])("ignores a selection event with %s", (_label, detail) => {
		const h = harness();
		selectWords(h, { from: "beta" });

		h.doc.dispatchEvent(new h.window.CustomEvent(HIGHLIGHT_SELECTION_EVENT, { detail }));

		expect(h.submitted).toHaveLength(0);
	});

	it("ignores a selection event with no range", () => {
		const h = harness();

		h.doc.dispatchEvent(
			new h.window.CustomEvent(HIGHLIGHT_SELECTION_EVENT, {
				detail: { origin: "tap" },
			}),
		);

		expect(h.submitted).toHaveLength(0);
	});

	it("ignores a selection event outside the article", () => {
		const h = harness();
		const outside = h.doc.getElementById("outside");
		assert(outside);
		selectWords(h, { from: "Outside", root: outside });

		h.doc.dispatchEvent(
			new h.window.CustomEvent(HIGHLIGHT_SELECTION_EVENT, {
				detail: { origin: "tap" },
			}),
		);

		expect(h.submitted).toHaveLength(0);
	});

	it("ignores a selection event on a page without reader content", () => {
		const h = harness(`<main>${renderHighlightToolbar({ scope: { articleId: "abc", readlist: [], surface: [] } })}<p id="outside">Outside</p></main>`);
		const outside = h.doc.getElementById("outside");
		assert(outside);
		selectWords(h, { from: "Outside", root: outside });

		h.doc.dispatchEvent(
			new h.window.CustomEvent(HIGHLIGHT_SELECTION_EVENT, {
				detail: { origin: "tap" },
			}),
		);

		expect(h.submitted).toHaveLength(0);
	});

	it("a mark click never scrolls the rail or the page", () => {
		const h = harness(mainHtml({ marks: true }));
		const mark = markWord(h, "beta");
		const row = h.doc.querySelector(`[data-highlight-row="${HIGHLIGHT_ID}"]`);
		assert(row);
		const scrolled: unknown[] = [];
		Object.defineProperty(row, "scrollIntoView", {
			value: (options: unknown) => scrolled.push(options),
		});
		const scrollYBefore = h.window.scrollY;

		click(h, mark);

		expect(scrolled).toEqual([]);
		expect(h.window.scrollY).toBe(scrollYBefore);
		expect(h.beacons).toEqual([`/queue/abc/highlights/opened?highlight=${HIGHLIGHT_ID}&origin=mark`]);
	});

	it("beacons a clicked mark as a highlight opened from the mark", () => {
		const h = harness(mainHtml({ marks: true }));

		click(h, markWord(h, "beta"));

		expect(h.beacons).toEqual([`/queue/abc/highlights/opened?highlight=${HIGHLIGHT_ID}&origin=mark`]);
	});

	it("beacons Enter on a keyboard-focused noted mark once, as a mark open", () => {
		const h = harness(mainHtml({ noted: true }));
		const mark = h.doc.querySelector(`mark#highlight-${HIGHLIGHT_ID}`);
		assert(mark);
		expect(mark.getAttribute("tabindex")).toBe("0");
		mark.dispatchEvent(new h.window.FocusEvent("focusin", { bubbles: true }));

		mark.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

		expect(h.beacons).toEqual([`/queue/abc/highlights/opened?highlight=${HIGHLIGHT_ID}&origin=mark`]);
	});

	it("hides a pinned note preview when the bar shows for a selection, and moves it on a scroll", () => {
		const h = harness(mainHtml({ noted: true }));
		const mark = h.doc.querySelector(`mark#highlight-${HIGHLIGHT_ID}`);
		const preview = h.doc.querySelector<HTMLElement>(`#preview-highlight-${HIGHLIGHT_ID}`);
		assert(mark && preview);
		Object.defineProperty(preview, "getBoundingClientRect", { value: () => ({ width: 100, height: 40 }) });
		click(h, mark);
		h.rects = [{ top: 500, bottom: 520, left: 400, width: 200 }];
		h.scrollWindow();
		h.runFrames();
		expect(preview.style.top).toBe(`${500 - 10 - 40}px`);

		selectWords(h, { from: "Delta" });
		settleSelection(h);

		expect(h.shownPopovers).toEqual([preview]);
		expect(h.hiddenPopovers).toEqual([preview]);
	});

	it("refuses a mark click when the toolbar names no opened beacon", () => {
		const h = harness(mainHtml({ marks: true }));
		toolbarOf(h).removeAttribute("data-highlight-opened-url");
		const errors: string[] = [];
		h.window.addEventListener("error", (event) => {
			event.preventDefault();
			errors.push(event.message);
		});

		click(h, markWord(h, "beta"));

		expect(errors).toEqual(["the highlight toolbar names its opened beacon"]);
	});

	it("beacons a rail Jump click as a highlight opened from the rail", () => {
		const h = harness(mainHtml({ marks: true }));
		const jump = h.doc.querySelector(`[data-highlight-jump="${HIGHLIGHT_ID}"]`);
		assert(jump);

		click(h, jump);

		expect(h.beacons).toEqual([`/queue/abc/highlights/opened?highlight=${HIGHLIGHT_ID}&origin=rail`]);
	});

	it("sends no beacon for a click on the rail outside a Jump link, or on the article outside a mark", () => {
		const h = harness(mainHtml({ marks: true }));
		const row = h.doc.querySelector(`[data-highlight-row="${HIGHLIGHT_ID}"]`);
		assert(row);

		click(h, row);
		click(h, contentOf(h));

		expect(h.beacons).toEqual([]);
	});

	describe("Add note", () => {
		const PASSAGE_CHANGED = "That passage changed; select it again";
		const SHORTER_PASSAGE = "Select a shorter passage";
		const NOTES_TOO_LONG = "Joined with the highlights it overlaps, the notes are over 8,191 characters.";

		function addNoteOf(h: Harness): Element {
			const button = h.doc.querySelector('[data-test-action="add-note"]');
			assert(button);
			return button;
		}

		function noteDialogOf(h: Harness): Element {
			const dialog = h.doc.getElementById("note-highlight-dialog");
			assert(dialog);
			return dialog;
		}

		function noteFormOf(h: Harness): HTMLFormElement {
			const form = noteDialogOf(h).querySelector("form");
			assert(form);
			return form;
		}

		function noteInputOf(form: Element): HTMLTextAreaElement {
			const input = form.querySelector<HTMLTextAreaElement>("[data-test-highlight-note-input]");
			assert(input);
			return input;
		}

		function noteErrorOf(form: Element): Element {
			const error = form.querySelector("[data-test-highlight-note-error]");
			assert(error);
			return error;
		}

		function passageFields(h: Harness, word: string): Record<string, string> {
			const start = servedText(h).indexOf(word);
			return { exact: word, start: String(start), end: String(start + word.length), origin: "mouse", answer: "dialog" };
		}

		function addNoteOn(h: Harness, word: string): void {
			selectWords(h, { from: word });
			settleSelection(h);
			click(h, addNoteOf(h));
		}

		function replaceWithRefusal(h: Harness, input: { error: string; refusal?: "passage" }): void {
			const form = noteFormOf(h);
			const fields = formFields(form);
			form.outerHTML = renderHighlightNoteCreateForm({
				action: "/queue/abc/highlights",
				hiddenFields: HIGHLIGHT_NOTE_CREATE_HIDDEN_FIELDS.map((field) => ({ name: field.name, value: fields[field.name] })),
				value: noteInputOf(form).value,
				error: input.error,
				refusal: input.refusal,
			});
		}

		it("fills the dialog's hidden inputs with the selection, opens the note dialog and hides the bar", () => {
			const h = harness();

			addNoteOn(h, "beta");

			expect(formFields(noteFormOf(h))).toEqual(passageFields(h, "beta"));
			expect(h.shownPopovers).toEqual([noteDialogOf(h)]);
			expect(toolbarOf(h).hidden).toBe(true);
			expect(h.submitted).toHaveLength(0);
		});

		it("does nothing without popover support, leaving the bar open", () => {
			const h = harness();
			h.popoverSupported = false;

			addNoteOn(h, "beta");

			expect(h.shownPopovers).toHaveLength(0);
			expect(formFields(noteFormOf(h)).exact).toBe("");
			expect(toolbarOf(h).hidden).toBe(false);
		});

		it("opens nothing when the article is gone by the time Add note is pressed", () => {
			const h = harness();
			selectWords(h, { from: "beta" });
			settleSelection(h);
			contentOf(h).remove();

			click(h, addNoteOf(h));

			expect(h.shownPopovers).toHaveLength(0);
			expect(formFields(noteFormOf(h)).exact).toBe("");
		});

		it("keeps the selection in the hidden inputs after the textarea takes focus", () => {
			const h = harness();
			addNoteOn(h, "beta");

			noteInputOf(noteFormOf(h)).focus();
			h.doc.getSelection()?.collapseToStart();
			settleSelection(h);

			expect(formFields(noteFormOf(h))).toEqual(passageFields(h, "beta"));
		});

		it("fills the live form after a 422 replaces it", () => {
			const h = harness();
			addNoteOn(h, "beta");
			replaceWithRefusal(h, { error: NOTES_TOO_LONG });

			addNoteOn(h, "zeta");

			expect(formFields(noteFormOf(h))).toEqual(passageFields(h, "zeta"));
		});

		it("empties a note typed before the dialog was hidden", () => {
			const h = harness();
			addNoteOn(h, "beta");
			noteInputOf(noteFormOf(h)).value = "First thought";

			addNoteOn(h, "zeta");

			expect(noteInputOf(noteFormOf(h)).value).toBe("");
		});

		it("clears the note, the error line and aria-invalid after the over-cap 422", () => {
			const h = harness();
			addNoteOn(h, "beta");
			noteInputOf(noteFormOf(h)).value = "A long note";
			replaceWithRefusal(h, { error: NOTES_TOO_LONG });
			expect(noteInputOf(noteFormOf(h)).getAttribute("aria-invalid")).toBe("true");

			addNoteOn(h, "zeta");

			const form = noteFormOf(h);
			expect(noteInputOf(form).value).toBe("");
			expect(noteErrorOf(form).textContent).toBe("");
			expect(noteInputOf(form).getAttribute("aria-invalid")).toBeNull();
		});

		it.each([PASSAGE_CHANGED, SHORTER_PASSAGE])("keeps the typed note for a new selection after the 422 %s", (error) => {
			const h = harness();
			addNoteOn(h, "beta");
			noteInputOf(noteFormOf(h)).value = "Keep this thought";
			replaceWithRefusal(h, { error, refusal: "passage" });

			addNoteOn(h, "zeta");

			const form = noteFormOf(h);
			expect(noteInputOf(form).value).toBe("Keep this thought");
			expect(noteErrorOf(form).textContent).toBe("");
			expect(formFields(form)).toEqual(passageFields(h, "zeta"));
		});

		it("fills the bar's dialog and leaves a rail row's dialog and fallback form untouched", () => {
			const h = harness(mainHtml({ rowNoteForms: true }));
			const rowForms = ["highlight-note-edit", "highlight-note-fallback"].map((key) => {
				const form = h.doc.querySelector(`[data-test-form="${key}"]`);
				assert(form);
				return form;
			});
			const before = rowForms.map((form) => form.outerHTML);

			addNoteOn(h, "beta");

			expect(formFields(noteFormOf(h))).toEqual(passageFields(h, "beta"));
			expect(rowForms.map((form) => form.outerHTML)).toEqual(before);
		});

		it("submits the create form, never the note form, from Highlight", () => {
			const h = harness();
			selectWords(h, { from: "beta" });
			settleSelection(h);

			click(h, buttonOf(h));

			expect(h.submitted).toEqual([h.doc.querySelector("[data-test-highlight-create-form]")]);
			expect(formFields(noteFormOf(h)).exact).toBe("");
		});
	});

	describe("placement", () => {
		function shownAt(h: Harness): { top: string; left: string } {
			selectWords(h, { from: "beta" });
			settleSelection(h);
			return { top: toolbarOf(h).style.top, left: toolbarOf(h).style.left };
		}

		it("sits above the first rect, centred on it", () => {
			const h = harness();

			expect(shownAt(h)).toEqual({
				top: `${300 - 44 - 10}px`,
				left: `${400 + 100 - 60}px`,
			});
		});

		it("flips below the last rect when there is no room above", () => {
			const h = harness();
			h.rects = [
				{ top: 20, bottom: 40, left: 400, width: 200 },
				{ top: 40, bottom: 60, left: 100, width: 300 },
			];

			expect(shownAt(h).top).toBe(`${60 + 10}px`);
		});

		it("clamps 16 px inside the left edge of the visual viewport", () => {
			const h = harness();
			h.rects = [{ top: 300, bottom: 320, left: 0, width: 10 }];
			h.viewport.offsetLeft = 50;
			h.viewport.offsetTop = 100;

			expect(shownAt(h)).toEqual({
				top: `${300 - 44 - 10}px`,
				left: `${16 + 50}px`,
			});
		});

		it("clamps 16 px inside the right edge of the visual viewport", () => {
			const h = harness();
			h.rects = [{ top: 300, bottom: 320, left: 990, width: 10 }];

			expect(shownAt(h).left).toBe(`${1000 - 120 - 16}px`);
		});

		it("flips below when the space above falls under the visual viewport's top", () => {
			const h = harness();
			h.viewport.offsetTop = 260;

			expect(shownAt(h).top).toBe(`${320 + 10}px`);
		});

		it("refuses a selection without client rects", () => {
			const h = harness();
			h.rects = [];
			selectWords(h, { from: "beta" });
			fire(h, "selectionchange");

			expect(() => h.runTimer(SELECTION_DEBOUNCE_MS)).toThrow("a selection holding text has client rects");
		});

		it.each(["scroll", "resize"] as const)("repositions on visualViewport %s in one animation frame", (type) => {
			const h = harness();
			shownAt(h);
			h.rects = [{ top: 500, bottom: 520, left: 400, width: 200 }];

			h.viewport.fire(type);
			h.viewport.fire(type);
			expect(h.frameCount()).toBe(1);
			expect(toolbarOf(h).style.top).toBe(`${300 - 44 - 10}px`);
			h.runFrames();

			expect(toolbarOf(h).style.top).toBe(`${500 - 44 - 10}px`);
			h.viewport.fire(type);
			expect(h.frameCount()).toBe(1);
		});

		describe("on a coarse pointer", () => {
			function coarseShownAt(h: Harness): string {
				h.coarse = true;
				return shownAt(h).top;
			}

			it("sits 10 px below the last rect", () => {
				const h = harness();

				expect(coarseShownAt(h)).toBe(`${320 + 10}px`);
				expect(toolbarOf(h).style.left).toBe(`${400 + 100 - 60}px`);
			});

			it("flips above when a visualViewport resize leaves no room below", () => {
				const h = harness();
				coarseShownAt(h);
				h.viewport.offsetTop = 0;
				h.viewport.height = 360;

				h.viewport.fire("resize");
				h.runFrames();

				expect(toolbarOf(h).style.top).toBe(`${300 - 10 - 44}px`);
			});

			it("repositions once for two visualViewport scrolls in one frame", () => {
				const h = harness();
				coarseShownAt(h);
				h.rects = [{ top: 100, bottom: 120, left: 400, width: 200 }];

				h.viewport.fire("scroll");
				h.viewport.fire("scroll");
				expect(h.frameCount()).toBe(1);
				h.runFrames();

				expect(toolbarOf(h).style.top).toBe(`${120 + 10}px`);
			});

			it("follows the selection on a passive window scroll", () => {
				const h = harness();
				coarseShownAt(h);
				h.rects = [{ top: 200, bottom: 220, left: 400, width: 200 }];

				h.scrollWindow();
				h.runFrames();

				expect(toolbarOf(h).style.top).toBe(`${220 + 10}px`);
			});

			it("leaves a hidden bar where it was on a window scroll", () => {
				const h = harness();
				coarseShownAt(h);
				h.doc.dispatchEvent(
					new h.window.KeyboardEvent("keydown", {
						key: "Escape",
						bubbles: true,
					}),
				);
				h.rects = [{ top: 200, bottom: 220, left: 400, width: 200 }];

				h.scrollWindow();
				h.runFrames();

				expect(toolbarOf(h).style.top).toBe(`${320 + 10}px`);
			});

			it("submits a long-pressed selection with origin longpress", () => {
				const h = harness();
				coarseShownAt(h);

				click(h, buttonOf(h));

				expect(formFields(h.submitted[0]).origin).toBe("longpress");
			});
		});

		it("keeps the above-first-rect rule on a fine pointer", () => {
			const h = harness();
			h.rects = [
				{ top: 300, bottom: 320, left: 400, width: 200 },
				{ top: 320, bottom: 340, left: 100, width: 200 },
			];

			expect(shownAt(h).top).toBe(`${300 - 44 - 10}px`);
		});

		it("leaves a hidden bar where it is on a viewport change", () => {
			const h = harness();

			h.viewport.fire("scroll");
			h.runFrames();

			expect(toolbarOf(h).style.top).toBe("");
		});
	});
});
