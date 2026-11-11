import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { articleBody } from "@packages/test-fixtures";
import { type DOMWindow, JSDOM } from "jsdom";
import { parseHTML } from "linkedom";
import { renderReaderReady } from "../reader-slot/reader-ready.component";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../reader-slot/section-pages";
import { HOVER_GRACE_MS, HOVER_SHOW_MS, initHighlightPreviews } from "./highlight-preview.client";
import type { PassageRect } from "./place-clear-of-passage";

const READER_SECTION = { requested: undefined, readerPath: "/queue/abc/view", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES };
const READER_URL = "https://example.com/post";
const APP_ORIGIN = "https://readplace.com";
const NOTED = HighlightIdSchema.parse("11111111-1111-4111-8111-111111111111");
const PLAIN = HighlightIdSchema.parse("22222222-2222-4222-8222-222222222222");
const OTHER = HighlightIdSchema.parse("33333333-3333-4333-8333-333333333333");
const CONTENT =
	"<p>Alpha beta gamma delta epsilon.</p><p>Zeta eta theta iota kappa.</p><p>Lambda mu nu xi omicron.</p>";
const PREVIEW_SIZE = { width: 200, height: 60 };

interface HighlightSpec {
	id: Highlight["highlightId"];
	exact: string;
	note?: string;
	occurrence?: number;
}

function servedText(content: string): string {
	const { document } = parseHTML(`<!doctype html><html><body><div id="root">${content}</div></body></html>`);
	const root = document.querySelector("#root");
	assert(root);
	return normaliseText(collectTextChunks<Node>(root)).text;
}

function highlightOf(input: { spec: HighlightSpec; text: string; orderKey: number }): Highlight {
	const start = input.text.indexOf(input.spec.exact);
	assert(start >= 0, `the content holds "${input.spec.exact}"`);
	return {
		highlightId: input.spec.id,
		highlightOf: READER_URL,
		exact: input.spec.exact,
		prefix: "",
		suffix: "",
		start,
		end: start + input.spec.exact.length,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: input.orderKey,
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
		...(input.spec.note === undefined ? {} : { note: input.spec.note }),
	};
}

function readerHtml(input: { content?: string; highlights: readonly HighlightSpec[] }): string {
	const content = input.content ?? CONTENT;
	const text = servedText(content);
	return renderReaderReady({
		readerSection: READER_SECTION,
		url: READER_URL,
		content: articleBody(content),
		appOrigin: APP_ORIGIN,
		highlights: {
			rows: input.highlights.map((spec, orderKey) => highlightOf({ spec, text, orderKey })),
			canonicalContentHash: "hash",
		},
	}).html;
}

interface Harness {
	doc: Document;
	window: DOMWindow;
	timers: Map<number, { callback: () => void; delayMs: number }>;
	runTimer(delayMs: number): void;
	rects: PassageRect[];
	viewport: { width: number; height: number; offsetLeft: number; offsetTop: number };
	hover: boolean;
	focusVisible: boolean;
	popoverSupported: boolean;
	shown: string[];
	hidden: string[];
	previews: ReturnType<typeof initHighlightPreviews>;
}

function harness(input: { content?: string; highlights: readonly HighlightSpec[]; popover?: boolean }): Harness {
	const dom = new JSDOM(
		`<!doctype html><html><body><main>${readerHtml(input)}<p id="outside">Outside the article</p></main></body></html>`,
	);
	const doc = dom.window.document;
	for (const preview of Array.from(doc.querySelectorAll("[data-highlight-preview]"))) {
		Object.defineProperty(preview, "getBoundingClientRect", { value: () => PREVIEW_SIZE, configurable: true });
	}
	const timers = new Map<number, { callback: () => void; delayMs: number }>();
	let nextHandle = 1;
	const h: Harness = {
		doc,
		window: dom.window,
		timers,
		runTimer(delayMs) {
			for (const [handle, timer] of timers) {
				if (timer.delayMs !== delayMs) continue;
				timers.delete(handle);
				timer.callback();
			}
		},
		rects: [{ top: 300, bottom: 320, left: 400, width: 200 }],
		viewport: { width: 1000, height: 800, offsetLeft: 0, offsetTop: 0 },
		hover: true,
		focusVisible: true,
		popoverSupported: input.popover ?? true,
		shown: [],
		hidden: [],
		previews: { hide: () => undefined, reposition: () => undefined },
	};
	h.previews = initHighlightPreviews({
		document: doc,
		window: {
			visualViewport: h.viewport,
			matchMedia: (query) => ({ matches: query === "(hover: hover)" && h.hover }),
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
		selectionOf: () => {
			const selection = doc.getSelection();
			assert(selection);
			return selection;
		},
		supportsPopover: () => h.popoverSupported,
		showPopover: (panel) => h.shown.push(panel.getAttribute("data-highlight-preview") ?? ""),
		hidePopover: (panel) => h.hidden.push(panel.getAttribute("data-highlight-preview") ?? ""),
		isFocusVisible: () => h.focusVisible,
	});
	return h;
}

function previewOf(h: Harness, id: string): HTMLElement {
	const preview = h.doc.querySelector<HTMLElement>(`[data-test-highlight-preview="${id}"]`);
	assert(preview, `the page renders the preview of ${id}`);
	return preview;
}

function segmentsOf(h: Harness, id: string): HTMLElement[] {
	return Array.from(h.doc.querySelectorAll<HTMLElement>(`mark[data-highlight-id="${id}"]`));
}

function firstSegment(h: Harness, id: string): HTMLElement {
	const [segment] = segmentsOf(h, id);
	assert(segment, `the page marks ${id}`);
	return segment;
}

function pointer(h: Harness, input: { type: string; target: Element; pointerType?: string; buttons?: number; relatedTarget?: Element | null }): void {
	const event = new h.window.MouseEvent(input.type, {
		bubbles: true,
		relatedTarget: input.relatedTarget === undefined ? h.doc.body : input.relatedTarget,
	});
	Object.defineProperty(event, "pointerType", { value: input.pointerType ?? "mouse" });
	Object.defineProperty(event, "buttons", { value: input.buttons ?? 0 });
	input.target.dispatchEvent(event);
}

function hoverOver(h: Harness, target: Element, init: { pointerType?: string; buttons?: number } = {}): void {
	pointer(h, { type: "pointerover", target, ...init });
}

function leave(h: Harness, input: { from: Element; to: Element | null }): void {
	pointer(h, { type: "pointerout", target: input.from, relatedTarget: input.to });
	if (input.to !== null) pointer(h, { type: "pointerover", target: input.to, relatedTarget: input.from });
}

function click(h: Harness, target: Element): void {
	target.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function pressDown(h: Harness, target: Element): void {
	pointer(h, { type: "pointerdown", target, buttons: 1 });
}

function focusIn(h: Harness, target: Element): void {
	target.dispatchEvent(new h.window.FocusEvent("focusin", { bubbles: true }));
}

function focusOut(h: Harness, target: Element): void {
	target.dispatchEvent(new h.window.FocusEvent("focusout", { bubbles: true }));
}

function key(h: Harness, input: { target: Element; key: string; repeat?: boolean }): KeyboardEvent {
	const event = new h.window.KeyboardEvent("keydown", {
		key: input.key,
		repeat: input.repeat ?? false,
		bubbles: true,
		cancelable: true,
	});
	input.target.dispatchEvent(event);
	return event;
}

function selectArticleWords(h: Harness, word: string): void {
	const content = h.doc.querySelector(".article-body__content");
	assert(content);
	const walker = h.doc.createTreeWalker(content, h.window.NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const at = (node.nodeValue ?? "").indexOf(word);
		if (at < 0) continue;
		const range = h.doc.createRange();
		range.setStart(node, at);
		range.setEnd(node, at + word.length);
		const selection = h.doc.getSelection();
		assert(selection);
		selection.removeAllRanges();
		selection.addRange(range);
		return;
	}
	throw new Error(`no text node holds "${word}"`);
}

function pinned(h: Harness, id: string): boolean {
	return previewOf(h, id).classList.contains("highlight-preview--pinned");
}

function tabStopIds(h: Harness): (string | null)[] {
	return Array.from(h.doc.querySelectorAll('mark[tabindex="0"]'), (mark) => mark.getAttribute("data-highlight-id"));
}

const NOTED_AND_PLAIN: readonly HighlightSpec[] = [
	{ id: NOTED, exact: "beta gamma", note: "Note one" },
	{ id: PLAIN, exact: "theta iota" },
];

const TWO_NOTED: readonly HighlightSpec[] = [
	{ id: NOTED, exact: "beta gamma", note: "Note one" },
	{ id: OTHER, exact: "mu nu", note: "Note two" },
];

describe("initHighlightPreviews", () => {
	describe("start", () => {
		it("starts nothing without the Popover API", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN, popover: false });
			const mark = firstSegment(h, NOTED);
			previewOf(h, NOTED);

			hoverOver(h, mark);
			h.runTimer(HOVER_SHOW_MS);
			focusIn(h, mark);
			click(h, mark);
			key(h, { target: mark, key: "Enter" });
			h.previews.hide();
			h.previews.reposition();

			expect(tabStopIds(h)).toEqual([]);
			expect(h.shown).toEqual([]);
		});

		it("gives each noted highlight one tab stop, described by its preview", () => {
			const h = harness({
				content: "<p>Alpha beta <em>gamma</em> delta epsilon.</p><p>Lambda mu nu xi omicron.</p>",
				highlights: [
					{ id: NOTED, exact: "beta gamma delta", note: "Three segments" },
					{ id: PLAIN, exact: "mu nu" },
				],
			});

			expect(segmentsOf(h, NOTED).length).toBeGreaterThan(1);
			expect(Array.from(h.doc.querySelectorAll("mark[tabindex]"))).toEqual([firstSegment(h, NOTED)]);
			expect(firstSegment(h, NOTED).getAttribute("aria-describedby")).toBe(`preview-highlight-${NOTED}`);
		});

		it("gives the tab stop to the first segment on the page when that segment carries no id", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const segment = firstSegment(h, NOTED);
			segment.removeAttribute("id");

			h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle", { bubbles: true }));

			expect(Array.from(h.doc.querySelectorAll('[tabindex="0"]'))).toEqual([segment]);
		});

		it("applies the tab stops again once a swap settles", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const main = h.doc.querySelector("main");
			assert(main);
			main.innerHTML = readerHtml({ highlights: [{ id: OTHER, exact: "mu nu", note: "Note two" }] });

			h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle", { bubbles: true }));

			expect(tabStopIds(h)).toEqual([OTHER]);
		});

		it("skips the segments inside a link and gives the tab stop to the first one outside it", () => {
			const h = harness({
				content: '<p>Read <a href="https://example.com/x">the linked words</a> then more text here.</p>',
				highlights: [{ id: NOTED, exact: "linked words then more", note: "Across a link" }],
			});

			const [inLink, afterLink] = segmentsOf(h, NOTED);
			expect(inLink.closest("a")).not.toBeNull();
			expect(Array.from(h.doc.querySelectorAll('[tabindex="0"]'))).toEqual([afterLink]);
		});

		it("gives no tab stop to a noted highlight wholly inside a link", () => {
			const h = harness({
				content: '<p>Read <a href="https://example.com/x">the linked words</a> then more text here.</p>',
				highlights: [{ id: NOTED, exact: "linked words", note: "Inside a link" }],
			});

			previewOf(h, NOTED);
			expect(segmentsOf(h, NOTED)).toHaveLength(1);
			expect(tabStopIds(h)).toEqual([]);
		});
	});

	describe("hover", () => {
		it("shows the preview after the hover delay, clear of the passage", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });

			hoverOver(h, firstSegment(h, NOTED));
			expect(h.shown).toEqual([]);
			h.runTimer(HOVER_SHOW_MS);

			expect(h.shown).toEqual([NOTED]);
			expect(previewOf(h, NOTED).style.top).toBe(`${300 - 10 - 60}px`);
			expect(previewOf(h, NOTED).style.left).toBe(`${400 + 100 - 100}px`);
		});

		it("stays while the pointer moves onto the preview, and hides after the grace once it leaves both", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);
			const preview = previewOf(h, NOTED);
			hoverOver(h, mark);
			h.runTimer(HOVER_SHOW_MS);

			leave(h, { from: mark, to: preview });
			h.runTimer(HOVER_GRACE_MS);
			expect(h.hidden).toEqual([]);

			leave(h, { from: preview, to: h.doc.body });
			h.runTimer(HOVER_GRACE_MS);
			expect(h.hidden).toEqual([NOTED]);
		});

		it("keeps a hovered preview through a touch leaving it", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);
			hoverOver(h, mark);
			h.runTimer(HOVER_SHOW_MS);

			pointer(h, { type: "pointerout", target: mark, pointerType: "touch" });
			h.runTimer(HOVER_GRACE_MS);

			expect(h.shown).toEqual([NOTED]);
			expect(h.hidden).toEqual([]);
		});

		it("shows nothing when the pointer leaves before the delay", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);

			hoverOver(h, mark);
			leave(h, { from: mark, to: h.doc.body });
			h.runTimer(HOVER_SHOW_MS);

			expect(h.shown).toEqual([]);
		});

		it("cancels the delay when the pointer leaves the page", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);

			hoverOver(h, mark);
			leave(h, { from: mark, to: null });
			h.runTimer(HOVER_SHOW_MS);

			expect(h.shown).toEqual([]);
		});

		it.each([
			["touch", { pointerType: "touch" }],
			["pen", { pointerType: "pen" }],
			["a held button", { buttons: 1 }],
		])("shows nothing for %s, beside a mouse hover that shows", (_name, init) => {
			const h = harness({ highlights: NOTED_AND_PLAIN });

			hoverOver(h, firstSegment(h, NOTED), init);
			h.runTimer(HOVER_SHOW_MS);
			expect(h.shown).toEqual([]);

			hoverOver(h, firstSegment(h, NOTED));
			h.runTimer(HOVER_SHOW_MS);
			expect(h.shown).toEqual([NOTED]);
		});

		it("shows nothing without a hover-capable pointer", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			h.hover = false;

			hoverOver(h, firstSegment(h, NOTED));
			h.runTimer(HOVER_SHOW_MS);
			expect(h.shown).toEqual([]);

			h.hover = true;
			hoverOver(h, firstSegment(h, PLAIN));
			hoverOver(h, firstSegment(h, NOTED));
			h.runTimer(HOVER_SHOW_MS);
			expect(h.shown).toEqual([NOTED]);
		});

		it("shows nothing while a selection in the article is open, at the hover or when the delay ends", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			selectArticleWords(h, "Lambda");

			hoverOver(h, firstSegment(h, NOTED));
			h.runTimer(HOVER_SHOW_MS);
			expect(h.shown).toEqual([]);

			h.doc.getSelection()?.removeAllRanges();
			hoverOver(h, firstSegment(h, PLAIN));
			hoverOver(h, firstSegment(h, NOTED));
			selectArticleWords(h, "Lambda");
			h.runTimer(HOVER_SHOW_MS);
			expect(h.shown).toEqual([]);
		});

		it("ignores a hover on a highlight without a note", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });

			hoverOver(h, firstSegment(h, PLAIN));
			h.runTimer(HOVER_SHOW_MS);

			expect(h.shown).toEqual([]);
			expect(h.timers.size).toBe(0);
		});

		it("keeps one pending show while the pointer moves within the mark", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);

			hoverOver(h, mark);
			hoverOver(h, mark);

			expect(Array.from(h.timers.values(), (timer) => timer.delayMs)).toEqual([HOVER_SHOW_MS]);
		});

		it("keeps a click's pin when a hover started just before it ends", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);

			hoverOver(h, mark);
			click(h, mark);
			h.runTimer(HOVER_SHOW_MS);
			leave(h, { from: mark, to: h.doc.body });
			h.runTimer(HOVER_GRACE_MS);

			expect(pinned(h, NOTED)).toBe(true);
			expect(h.shown).toEqual([NOTED]);
		});

		it("drops a pending show when the toolbar's surface hides the previews", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });

			hoverOver(h, firstSegment(h, NOTED));
			h.previews.hide();
			h.runTimer(HOVER_SHOW_MS);

			expect(h.shown).toEqual([]);
		});

		it("drops a pending show on a press", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });

			hoverOver(h, firstSegment(h, NOTED));
			pressDown(h, firstSegment(h, NOTED));
			h.runTimer(HOVER_SHOW_MS);

			expect(h.shown).toEqual([]);
		});

		it("lets the innermost noted highlight win, even over an un-noted one inside it", () => {
			const h = harness({
				highlights: [
					{ id: NOTED, exact: "beta gamma delta", note: "Outer note" },
					{ id: PLAIN, exact: "gamma" },
				],
			});
			const inner = firstSegment(h, PLAIN);
			expect(inner.closest(`mark[data-highlight-id="${NOTED}"]`)).not.toBeNull();

			hoverOver(h, inner);
			h.runTimer(HOVER_SHOW_MS);

			expect(h.shown).toEqual([NOTED]);
		});

		it("keeps a preview of a passage taller than the viewport inside the visual viewport", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			h.rects = [{ top: -200, bottom: 1200, left: 400, width: 200 }];

			hoverOver(h, firstSegment(h, NOTED));
			h.runTimer(HOVER_SHOW_MS);

			expect(previewOf(h, NOTED).style.top).toBe(`${800 - 16 - 60}px`);
		});

		it("swaps a hovered preview for another highlight's", () => {
			const h = harness({ highlights: TWO_NOTED });

			hoverOver(h, firstSegment(h, NOTED));
			h.runTimer(HOVER_SHOW_MS);
			hoverOver(h, firstSegment(h, OTHER));
			h.runTimer(HOVER_SHOW_MS);

			expect(h.shown).toEqual([NOTED, OTHER]);
			expect(h.hidden).toEqual([NOTED]);
		});
	});

	describe("keyboard focus", () => {
		it("shows the preview at once on keyboard focus and hides it after the grace once focus leaves", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);

			focusIn(h, mark);
			expect(h.shown).toEqual([NOTED]);

			focusOut(h, mark);
			h.runTimer(HOVER_GRACE_MS);
			expect(h.hidden).toEqual([NOTED]);
		});

		it("shows nothing for focus a mouse press gave", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			h.focusVisible = false;
			const mark = firstSegment(h, NOTED);

			focusIn(h, mark);
			focusOut(h, mark);

			expect(h.shown).toEqual([]);
		});

		it("keeps a focused preview while the pointer leaves, and a hovered one while focus leaves", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);

			focusIn(h, mark);
			hoverOver(h, mark);
			leave(h, { from: mark, to: h.doc.body });
			h.runTimer(HOVER_GRACE_MS);
			expect(h.hidden).toEqual([]);

			hoverOver(h, mark);
			focusOut(h, mark);
			h.runTimer(HOVER_GRACE_MS);
			expect(h.hidden).toEqual([]);
		});

		it("ignores focus on an element that is not a tab stop", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const outside = h.doc.querySelector("#outside");
			assert(outside);

			focusIn(h, outside);
			focusOut(h, outside);

			expect(h.shown).toEqual([]);
		});
	});

	describe("click", () => {
		it("pins the preview through the pointer and focus leaving and past the grace", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);
			const scrollY = h.window.scrollY;

			click(h, mark);
			leave(h, { from: mark, to: h.doc.body });
			focusOut(h, mark);
			h.runTimer(HOVER_GRACE_MS);

			expect(h.shown).toEqual([NOTED]);
			expect(h.hidden).toEqual([]);
			expect(pinned(h, NOTED)).toBe(true);
			expect(h.window.scrollY).toBe(scrollY);
		});

		it("keeps a pinned preview on a second click on the mark and on a click inside it", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);

			click(h, mark);
			click(h, mark);
			click(h, previewOf(h, NOTED).querySelector("p") ?? previewOf(h, NOTED));

			expect(h.shown).toEqual([NOTED]);
			expect(pinned(h, NOTED)).toBe(true);
		});

		it("pins a hovered preview when it is clicked", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);
			hoverOver(h, mark);
			h.runTimer(HOVER_SHOW_MS);

			leave(h, { from: mark, to: previewOf(h, NOTED) });
			click(h, previewOf(h, NOTED));
			leave(h, { from: previewOf(h, NOTED), to: h.doc.body });
			h.runTimer(HOVER_GRACE_MS);

			expect(pinned(h, NOTED)).toBe(true);
			expect(h.hidden).toEqual([]);
		});

		it("keeps a pinned preview through a hover on another noted highlight and a selection inside it", () => {
			const h = harness({ highlights: TWO_NOTED });
			click(h, firstSegment(h, NOTED));
			const note = previewOf(h, NOTED).querySelector("p");
			assert(note?.firstChild);
			const range = h.doc.createRange();
			range.selectNodeContents(note.firstChild);
			h.doc.getSelection()?.addRange(range);

			hoverOver(h, firstSegment(h, OTHER));
			h.runTimer(HOVER_SHOW_MS);
			click(h, note);

			expect(h.shown).toEqual([NOTED]);
			expect(pinned(h, NOTED)).toBe(true);
		});

		it("swaps the pinned preview on a click on another noted highlight", () => {
			const h = harness({ highlights: TWO_NOTED });

			click(h, firstSegment(h, NOTED));
			click(h, firstSegment(h, OTHER));

			expect(h.shown).toEqual([NOTED, OTHER]);
			expect(h.hidden).toEqual([NOTED]);
			expect(pinned(h, NOTED)).toBe(false);
			expect(pinned(h, OTHER)).toBe(true);
		});

		it("hides the pinned preview on a press and a click elsewhere", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const outside = h.doc.querySelector("#outside");
			assert(outside);
			click(h, firstSegment(h, NOTED));

			pressDown(h, outside);
			click(h, outside);

			expect(h.hidden).toEqual([NOTED]);
			expect(pinned(h, NOTED)).toBe(false);
		});

		it("hides the pinned preview on a click elsewhere without a press, as a keyboard-activated link gives", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const outside = h.doc.querySelector("#outside");
			assert(outside);
			click(h, firstSegment(h, NOTED));

			click(h, outside);

			expect(h.hidden).toEqual([NOTED]);
		});

		it("keeps the pinned preview on a press on its mark or inside it", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			click(h, firstSegment(h, NOTED));

			pressDown(h, firstSegment(h, NOTED));
			pressDown(h, previewOf(h, NOTED));

			expect(h.hidden).toEqual([]);
		});

		it("pins the noted outer highlight's preview for a click on an un-noted highlight inside it", () => {
			const h = harness({
				highlights: [
					{ id: NOTED, exact: "beta gamma delta", note: "Outer note" },
					{ id: PLAIN, exact: "gamma" },
				],
			});

			click(h, firstSegment(h, PLAIN));

			expect(h.shown).toEqual([NOTED]);
			expect(pinned(h, NOTED)).toBe(true);
		});

		it("pins nothing for a click on a highlighted word inside a link", () => {
			const h = harness({
				content: '<p>Read <a href="https://example.com/x">the linked words</a> then more text here.</p>',
				highlights: [{ id: NOTED, exact: "linked words", note: "Inside a link" }],
			});
			h.doc.querySelector("a")?.addEventListener("click", (event) => event.preventDefault());

			click(h, firstSegment(h, NOTED));

			expect(h.shown).toEqual([]);
			expect(pinned(h, NOTED)).toBe(false);
		});

		it("pins nothing for a click while a selection in the article is open", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			selectArticleWords(h, "Lambda");

			click(h, firstSegment(h, NOTED));

			expect(h.shown).toEqual([]);
			expect(pinned(h, NOTED)).toBe(false);
		});

		it("places a pinned preview again from fresh rects on reposition", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			click(h, firstSegment(h, NOTED));
			h.rects = [{ top: 500, bottom: 520, left: 400, width: 200 }];

			h.previews.reposition();

			expect(previewOf(h, NOTED).style.top).toBe(`${500 - 10 - 60}px`);
		});

		it("forgets a shown preview a swap removed, without hiding the new one", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			click(h, firstSegment(h, NOTED));
			const main = h.doc.querySelector("main");
			assert(main);
			main.innerHTML = readerHtml({ highlights: NOTED_AND_PLAIN });
			h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle", { bubbles: true }));

			h.previews.reposition();
			h.previews.hide();

			expect(h.hidden).toEqual([]);
			expect(pinned(h, NOTED)).toBe(false);
		});

		it("refuses a shown preview whose highlight has no client rects", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			click(h, firstSegment(h, NOTED));
			h.rects = [];

			expect(() => h.previews.reposition()).toThrow("a shown preview's highlight has client rects");
		});
	});

	describe("keys", () => {
		it.each(["Enter", " "])("pins the preview on %j at a keyboard-focused tab stop, without paging", (pressed) => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);
			focusIn(h, mark);

			const event = key(h, { target: mark, key: pressed });

			expect(event.defaultPrevented).toBe(true);
			expect(pinned(h, NOTED)).toBe(true);
		});

		it("does nothing more for a repeated key", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);
			const clicks: unknown[] = [];
			mark.addEventListener("click", (event) => clicks.push(event));
			focusIn(h, mark);

			key(h, { target: mark, key: "Enter" });
			key(h, { target: mark, key: "Enter", repeat: true });

			expect(clicks).toHaveLength(1);
		});

		it("keeps Enter and Space for the page on a tab stop a mouse press focused", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			h.focusVisible = false;
			const mark = firstSegment(h, NOTED);
			focusIn(h, mark);

			const enter = key(h, { target: mark, key: "Enter" });
			const space = key(h, { target: mark, key: " " });

			expect(h.shown).toEqual([]);
			expect(pinned(h, NOTED)).toBe(false);
			expect(enter.defaultPrevented).toBe(false);
			expect(space.defaultPrevented).toBe(false);
		});

		it("pins from the tab stop after a link without activating the link", () => {
			const h = harness({
				content: '<p>Read <a href="https://example.com/x">the linked words</a> then more text here.</p>',
				highlights: [{ id: NOTED, exact: "linked words then more", note: "Across a link" }],
			});
			const link = h.doc.querySelector("a");
			assert(link);
			const activations: unknown[] = [];
			link.addEventListener("click", (event) => {
				event.preventDefault();
				activations.push(event);
			});
			const [inLink, stop] = segmentsOf(h, NOTED);
			focusIn(h, stop);

			key(h, { target: stop, key: "Enter" });
			key(h, { target: stop, key: " " });

			expect(pinned(h, NOTED)).toBe(true);
			expect(activations).toEqual([]);
			expect(inLink.hasAttribute("tabindex")).toBe(false);
		});

		it("hides a pinned or a hovered preview on Escape without moving focus", () => {
			const h = harness({ highlights: TWO_NOTED });
			const mark = firstSegment(h, NOTED);
			mark.focus();
			click(h, mark);

			key(h, { target: mark, key: "Escape" });
			hoverOver(h, firstSegment(h, OTHER));
			h.runTimer(HOVER_SHOW_MS);
			key(h, { target: mark, key: "Escape" });

			expect(h.hidden).toEqual([NOTED, OTHER]);
			expect(h.doc.activeElement).toBe(mark);
		});

		it("ignores other keys", () => {
			const h = harness({ highlights: NOTED_AND_PLAIN });
			const mark = firstSegment(h, NOTED);
			focusIn(h, mark);

			const event = key(h, { target: mark, key: "a" });

			expect(event.defaultPrevented).toBe(false);
			expect(pinned(h, NOTED)).toBe(false);
		});
	});
});
