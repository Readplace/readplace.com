import assert from "node:assert/strict";
import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { articleBody } from "@packages/test-fixtures";
import { type DOMWindow, JSDOM } from "jsdom";
import { parseHTML } from "linkedom";
import { highlightsRailRowsFromStates, renderHighlightsRail } from "../highlights-rail/highlights-rail.component";
import { renderReaderReady } from "../reader-slot/reader-ready.component";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../reader-slot/section-pages";
import { initHighlightPanels } from "./highlight-popover.client";
import { initHighlightPreviews } from "./highlight-preview.client";
import type { PassageRect } from "./place-clear-of-passage";

const READER_SECTION = { requested: undefined, readerPath: "/queue/abc/view", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES };
const READER_URL = "https://example.com/post";
const APP_ORIGIN = "https://readplace.com";
const SCOPE = { articleId: "abc", readlist: [], surface: [] };
const FIRST = HighlightIdSchema.parse("11111111-1111-4111-8111-111111111111");
const SECOND = HighlightIdSchema.parse("22222222-2222-4222-8222-222222222222");
const THIRD = HighlightIdSchema.parse("33333333-3333-4333-8333-333333333333");
const CONTENT =
	"<p>Alpha beta gamma delta epsilon.</p><p>Zeta eta theta iota kappa.</p><p>Lambda mu nu xi omicron.</p>";
const PANEL_SIZE = { width: 200, height: 100 };

interface HighlightSpec {
	id: Highlight["highlightId"];
	exact: string;
	note?: string;
}

const THREE: readonly HighlightSpec[] = [
	{ id: FIRST, exact: "beta gamma" },
	{ id: SECOND, exact: "theta iota", note: "Second note" },
	{ id: THIRD, exact: "mu nu" },
];

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

function mainHtml(input: { content?: string; highlights: readonly HighlightSpec[]; scoped?: boolean }): string {
	const content = input.content ?? CONTENT;
	const text = servedText(content);
	const reader = renderReaderReady({
		readerSection: READER_SECTION,
		url: READER_URL,
		content: articleBody(content),
		appOrigin: APP_ORIGIN,
		highlights: {
			rows: input.highlights.map((spec, orderKey) => highlightOf({ spec, text, orderKey })),
			canonicalContentHash: "hash",
			scope: input.scoped === false ? undefined : SCOPE,
		},
	});
	const rail = renderHighlightsRail({
		rows: highlightsRailRowsFromStates(reader.states),
		scope: SCOPE,
		openNote: undefined,
		oob: false,
	});
	return `${reader.html}${rail.html}<p id="outside" tabindex="-1">Outside the article</p>`;
}

interface Harness {
	doc: Document;
	window: DOMWindow;
	rects: PassageRect[];
	viewport: { width: number; height: number; offsetLeft: number; offsetTop: number };
	resize(): void;
	focusVisible: boolean;
	open: Set<Element>;
	shown: string[];
	hidden: string[];
	focusAtShow: (Element | null)[];
	panels: ReturnType<typeof initHighlightPanels>;
	swap(input: { highlights: readonly HighlightSpec[] }): void;
}

function harness(input: { content?: string; highlights: readonly HighlightSpec[]; scoped?: boolean }): Harness {
	const dom = new JSDOM(`<!doctype html><html><body><main>${mainHtml(input)}</main></body></html>`);
	const doc = dom.window.document;
	const returnTo = new Map<Element, Element | null>();
	const resizeListeners: (() => void)[] = [];
	const sizePanels = (): void => {
		for (const panel of Array.from(doc.querySelectorAll("[data-highlight-popover]"))) {
			Object.defineProperty(panel, "getBoundingClientRect", { value: () => PANEL_SIZE, configurable: true });
		}
	};
	sizePanels();
	const nameOf = (popover: Element): string => {
		const preview = popover.getAttribute("data-highlight-preview");
		return preview === null ? (popover.getAttribute("data-highlight-popover") ?? popover.id) : `preview:${preview}`;
	};
	const h: Harness = {
		doc,
		window: dom.window,
		rects: [{ top: 300, bottom: 320, left: 400, width: 200 }],
		viewport: { width: 1000, height: 800, offsetLeft: 0, offsetTop: 0 },
		resize: () => {
			for (const listener of resizeListeners) listener();
		},
		focusVisible: true,
		open: new Set(),
		shown: [],
		hidden: [],
		focusAtShow: [],
		panels: { has: () => false, open: () => false, quietsPreview: () => false, reposition: () => undefined, restoreFocus: () => undefined, hide: () => undefined },
		swap: (next) => {
			doc.dispatchEvent(new dom.window.Event("htmx:beforeSwap", { bubbles: true }));
			const main = doc.querySelector("main");
			assert(main);
			main.innerHTML = mainHtml({ content: input.content, highlights: next.highlights });
			sizePanels();
			doc.dispatchEvent(new dom.window.Event("htmx:afterSettle", { bubbles: true }));
		},
	};
	const showPopover = (popover: Element): void => {
		h.shown.push(nameOf(popover));
		h.focusAtShow.push(doc.activeElement);
		h.open.add(popover);
		returnTo.set(popover, doc.activeElement);
		popover.querySelector<HTMLElement>("[autofocus]")?.focus();
	};
	const hidePopover = (popover: Element): void => {
		h.hidden.push(nameOf(popover));
		h.open.delete(popover);
		const back = returnTo.get(popover);
		if (popover.contains(doc.activeElement) && back instanceof dom.window.HTMLElement) back.focus({ preventScroll: true });
	};
	const viewport = {
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
	};
	h.panels = initHighlightPanels({
		document: doc,
		window: { visualViewport: { ...viewport, addEventListener: (_type, listener) => resizeListeners.push(listener) } },
		rectsOf: () => h.rects,
		showPopover,
		hidePopover,
		isOpen: (popover) => h.open.has(popover),
	});
	initHighlightPreviews({
		document: doc,
		window: { visualViewport: viewport, matchMedia: () => ({ matches: true }) },
		timers: { setTimeout: () => undefined, clearTimeout: () => undefined },
		rectsOf: () => h.rects,
		editorOpen: () => false,
		selectionOf: () => {
			const selection = doc.getSelection();
			assert(selection);
			return selection;
		},
		supportsPopover: () => true,
		showPopover,
		hidePopover,
		isFocusVisible: () => h.focusVisible,
		panels: h.panels,
	});
	return h;
}

function segmentsOf(h: Harness, id: string): HTMLElement[] {
	return Array.from(h.doc.querySelectorAll<HTMLElement>(`mark[data-highlight-id="${id}"]`));
}

function stopOf(h: Harness, id: string): HTMLElement {
	const [segment] = segmentsOf(h, id);
	assert(segment, `the page marks ${id}`);
	return segment;
}

function panelOf(h: Harness, id: string): HTMLElement {
	const panel = h.doc.querySelector<HTMLElement>(`[data-highlight-popover="${id}"]`);
	assert(panel, `the page renders the panel of ${id}`);
	return panel;
}

function actionOf(h: Harness, input: { id: string; action: string }): HTMLElement {
	const action = panelOf(h, input.id).querySelector<HTMLElement>(`[data-test-action="${input.action}"]`);
	assert(action, `the panel of ${input.id} offers ${input.action}`);
	return action;
}

function click(h: Harness, target: Element): void {
	target.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function keyboardFocus(h: Harness, target: HTMLElement): void {
	target.focus();
}

function key(h: Harness, input: { type?: "keydown" | "keyup"; target: Element; key: string; repeat?: boolean }): KeyboardEvent {
	const event = new h.window.KeyboardEvent(input.type ?? "keydown", {
		key: input.key,
		repeat: input.repeat ?? false,
		bubbles: true,
		cancelable: true,
	});
	input.target.dispatchEvent(event);
	return event;
}

function submit(h: Harness, input: { form: HTMLFormElement; submitter?: HTMLElement }): void {
	const event = new h.window.Event("submit", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "submitter", { value: input.submitter ?? null });
	input.form.dispatchEvent(event);
}

function formIn(h: Harness, selector: string): HTMLFormElement {
	const form = h.doc.querySelector<HTMLFormElement>(selector);
	assert(form, `the page renders ${selector}`);
	return form;
}

function topLeftOf(panel: HTMLElement): { top: string; left: string } {
	return { top: panel.style.top, left: panel.style.left };
}

describe("initHighlightPanels", () => {
	describe("tab stops", () => {
		it("makes each highlight one tab stop that controls its panel, described by its preview and the hint", () => {
			const h = harness({ highlights: THREE });

			expect(
				Array.from(h.doc.querySelectorAll('mark[tabindex="0"]'), (mark) => ({
					id: mark.getAttribute("data-highlight-id"),
					controls: mark.getAttribute("aria-controls"),
					describedBy: mark.getAttribute("aria-describedby"),
				})),
			).toEqual([
				{ id: FIRST, controls: `manage-highlight-${FIRST}`, describedBy: "manage-highlight-hint" },
				{ id: SECOND, controls: `manage-highlight-${SECOND}`, describedBy: `preview-highlight-${SECOND} manage-highlight-hint` },
				{ id: THIRD, controls: `manage-highlight-${THIRD}`, describedBy: "manage-highlight-hint" },
			]);
		});

		it("makes the first segment on the page the tab stop when the highlight's id sits on an earlier page", () => {
			const h = harness({ highlights: [{ id: FIRST, exact: "epsilon.\nZeta eta" }] });
			const [first, second] = segmentsOf(h, FIRST);
			first.remove();

			h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle", { bubbles: true }));
			click(h, second);

			expect(second.id).toBe("");
			expect(second.getAttribute("tabindex")).toBe("0");
			expect(h.shown).toEqual([FIRST]);
			expect(h.focusAtShow).toEqual([second]);
		});
	});

	describe("focus", () => {
		it("ignores focus that lands on the document itself", () => {
			const h = harness({ highlights: THREE });

			h.doc.dispatchEvent(new h.window.FocusEvent("focusin"));

			expect(h.shown).toEqual([]);
		});
	});

	describe("opening", () => {
		it("opens the clicked highlight's actions with focus on the first one", () => {
			const h = harness({ highlights: THREE });

			click(h, stopOf(h, FIRST));

			expect(h.shown).toEqual([FIRST]);
			expect(h.doc.activeElement).toBe(actionOf(h, { id: FIRST, action: "highlight-panel-note" }));
		});

		it("opens the innermost highlight's actions when highlights overlap", () => {
			const h = harness({
				highlights: [
					{ id: FIRST, exact: "beta gamma delta" },
					{ id: SECOND, exact: "gamma" },
				],
			});

			click(h, stopOf(h, SECOND));

			expect(stopOf(h, SECOND).parentElement?.closest(`[data-highlight-id="${FIRST}"]`)).not.toBeNull();
			expect(h.shown).toEqual([SECOND]);
		});

		it("focuses the highlight before its actions open, when a later segment is clicked", () => {
			const h = harness({ highlights: [{ id: FIRST, exact: "epsilon.\nZeta eta" }] });
			const [first, second] = segmentsOf(h, FIRST);

			click(h, second);

			expect(h.focusAtShow).toEqual([first]);
		});

		it("focuses the inner highlight before its actions open when it sits inside another highlight", () => {
			const h = harness({
				highlights: [
					{ id: FIRST, exact: "beta gamma delta" },
					{ id: SECOND, exact: "gamma" },
				],
			});

			click(h, stopOf(h, SECOND));

			expect(h.focusAtShow).toEqual([stopOf(h, SECOND)]);
		});

		it("hides the note preview when the actions open", () => {
			const h = harness({ highlights: THREE });
			const stop = stopOf(h, SECOND);
			keyboardFocus(h, stop);

			key(h, { target: stop, key: "Enter" });

			expect(h.shown).toEqual([`preview:${SECOND}`, SECOND]);
			expect(h.hidden).toEqual([`preview:${SECOND}`]);
			expect(h.doc.querySelector(".highlight-preview--pinned")).toBeNull();
		});

		it("opens nothing while a note editor is open, leaving the preview to pin", () => {
			const h = harness({ highlights: THREE });
			const editor = h.doc.getElementById(`note-highlight-${FIRST}`);
			assert(editor, "the rail renders the note editor");
			h.open.add(editor);

			click(h, stopOf(h, SECOND));

			expect(h.shown).toEqual([`preview:${SECOND}`]);
			expect(h.doc.querySelector(".highlight-preview--pinned")?.getAttribute("data-highlight-preview")).toBe(SECOND);
		});

		it("pins the note preview on a page without panels", () => {
			const h = harness({ highlights: THREE, scoped: false });

			click(h, stopOf(h, SECOND));

			expect(h.doc.querySelector("#manage-highlights")).toBeNull();
			expect(h.doc.querySelector(".highlight-preview--pinned")?.getAttribute("data-highlight-preview")).toBe(SECOND);
		});

		it("leaves a click on a link inside a highlight to the link", () => {
			const h = harness({
				content: '<p>Read <a href="https://example.com/x">the linked words</a> then more text here.</p>',
				highlights: [{ id: FIRST, exact: "linked words then more" }],
			});

			click(h, stopOf(h, FIRST));

			expect(stopOf(h, FIRST).closest("a")).not.toBeNull();
			expect(h.shown).toEqual([]);
		});
	});

	describe("keys", () => {
		it.each(["Enter", " "])("opens a keyboard-focused highlight's actions on %j without the page's default", (pressed) => {
			const h = harness({ highlights: THREE });
			const stop = stopOf(h, FIRST);
			keyboardFocus(h, stop);

			const event = key(h, { target: stop, key: pressed });

			expect(event.defaultPrevented).toBe(true);
			expect(h.shown).toEqual([FIRST]);
		});

		it("keeps Space for the page on a highlight a click focused", () => {
			const h = harness({ highlights: THREE });
			h.focusVisible = false;
			const stop = stopOf(h, FIRST);
			stop.focus();

			const event = key(h, { target: stop, key: " " });
			const released = key(h, { type: "keyup", target: stop, key: " " });

			expect([event.defaultPrevented, released.defaultPrevented]).toEqual([false, false]);
			expect(h.shown).toEqual([]);
		});

		it.each(["Enter", " "])("keeps a held %j from pressing the first action until it is released", (pressed) => {
			const h = harness({ highlights: THREE });
			const stop = stopOf(h, FIRST);
			keyboardFocus(h, stop);
			key(h, { target: stop, key: pressed });
			const first = actionOf(h, { id: FIRST, action: "highlight-panel-note" });

			const repeated = key(h, { target: first, key: pressed, repeat: true });
			const otherReleased = key(h, { type: "keyup", target: first, key: "Shift" });
			const released = key(h, { type: "keyup", target: first, key: pressed });
			const pressedAgain = key(h, { target: first, key: pressed });

			expect(h.doc.activeElement).toBe(first);
			expect([
				repeated.defaultPrevented,
				otherReleased.defaultPrevented,
				released.defaultPrevented,
				pressedAgain.defaultPrevented,
			]).toEqual([true, false, true, false]);
		});

		it("holds no key in a panel a click opened after a key release that never arrived", () => {
			const h = harness({ highlights: THREE });
			const outside = h.doc.getElementById("outside");
			assert(outside);
			key(h, { target: outside, key: "Enter" });
			const stop = stopOf(h, FIRST);

			stop.dispatchEvent(new h.window.MouseEvent("pointerdown", { bubbles: true }));
			click(h, stop);
			const pressed = key(h, { target: actionOf(h, { id: FIRST, action: "highlight-panel-note" }), key: "Enter" });

			expect(h.shown).toEqual([FIRST]);
			expect(pressed.defaultPrevented).toBe(false);
		});

		it("leaves a held key alone outside the panel", () => {
			const h = harness({ highlights: THREE });
			const stop = stopOf(h, FIRST);
			keyboardFocus(h, stop);
			key(h, { target: stop, key: "Enter" });
			const outside = h.doc.getElementById("outside");
			assert(outside);

			const repeated = key(h, { target: outside, key: "Enter", repeat: true });
			const released = key(h, { type: "keyup", target: outside, key: "Enter" });

			expect([repeated.defaultPrevented, released.defaultPrevented]).toEqual([false, false]);
		});

		it("opens the focused highlight on Enter even when another is nested inside it", () => {
			const h = harness({
				highlights: [
					{ id: FIRST, exact: "beta gamma delta" },
					{ id: SECOND, exact: "gamma" },
				],
			});
			const outer = stopOf(h, FIRST);
			keyboardFocus(h, outer);

			key(h, { target: outer, key: "Enter" });

			expect(h.shown).toEqual([FIRST]);
		});
	});

	describe("placement", () => {
		it("places the actions above the passage, or below it when there is no room above", () => {
			const h = harness({ highlights: THREE });

			click(h, stopOf(h, FIRST));
			const above = topLeftOf(panelOf(h, FIRST));
			h.rects = [{ top: 40, bottom: 60, left: 400, width: 200 }];
			click(h, stopOf(h, THIRD));

			expect(above).toEqual({ top: "190px", left: "400px" });
			expect(topLeftOf(panelOf(h, THIRD))).toEqual({ top: "70px", left: "400px" });
		});

		it("docks the actions to the bottom edge when neither side fits", () => {
			const h = harness({ highlights: THREE });
			h.resize();
			h.rects = [{ top: 50, bottom: 760, left: 400, width: 200 }];

			click(h, stopOf(h, FIRST));

			expect(topLeftOf(panelOf(h, FIRST))).toEqual({ top: "684px", left: "16px" });
			expect(panelOf(h, FIRST).style.maxWidth).toBe("968px");
		});

		it("keeps the placement mode while scrolling and chooses it again on resize", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));

			h.rects = [{ top: 40, bottom: 60, left: 400, width: 200 }];
			h.panels.reposition();
			const scrolled = topLeftOf(panelOf(h, FIRST));
			h.resize();
			h.panels.reposition();

			expect(scrolled).toEqual({ top: "-70px", left: "400px" });
			expect(topLeftOf(panelOf(h, FIRST))).toEqual({ top: "70px", left: "400px" });
		});

		it("forgets a panel once it closes", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			const placed = topLeftOf(panelOf(h, FIRST));
			h.open.clear();
			h.rects = [{ top: 40, bottom: 60, left: 400, width: 200 }];
			h.resize();

			h.panels.reposition();

			expect(topLeftOf(panelOf(h, FIRST))).toEqual(placed);
			expect(h.panels.quietsPreview()).toBe(false);
		});

		it("refuses an open panel whose highlight has no client rects", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			h.rects = [];

			expect(() => h.panels.reposition()).toThrow("an open panel's highlight has client rects");
		});
	});

	describe("handing over to a dialog", () => {
		it("hides the open actions when a note editor opens, and quiets nothing after", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));

			h.panels.hide();

			expect({ hidden: h.hidden, quiets: h.panels.quietsPreview() }).toEqual({ hidden: [FIRST], quiets: false });
		});

		it("hides nothing when a note editor opens with no actions open", () => {
			const h = harness({ highlights: THREE });

			h.panels.hide();

			expect(h.hidden).toEqual([]);
		});

		it("closes the actions while the click on one is dispatched, so its dialog opens on its own", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			const action = actionOf(h, { id: FIRST, action: "highlight-panel-note" });
			const hiddenDuringClick: string[][] = [];
			action.addEventListener("click", () => hiddenDuringClick.push([...h.hidden]));

			click(h, action);

			expect(hiddenDuringClick).toEqual([[]]);
			expect(h.hidden).toEqual([FIRST]);
			expect(h.doc.activeElement).toBe(stopOf(h, FIRST));
		});

		it("shows no preview while focus passes back to a noted highlight on the way to its dialog", () => {
			const h = harness({ highlights: THREE });
			const stop = stopOf(h, SECOND);
			keyboardFocus(h, stop);
			key(h, { target: stop, key: "Enter" });

			click(h, actionOf(h, { id: SECOND, action: "highlight-panel-note" }));

			expect(h.doc.activeElement).toBe(stop);
			expect(h.shown).toEqual([`preview:${SECOND}`, SECOND]);
		});

		it("returns focus to the highlight after its note is saved", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			click(h, actionOf(h, { id: FIRST, action: "highlight-panel-note" }));

			submit(h, { form: formIn(h, `#note-highlight-${FIRST} form`) });
			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(stopOf(h, FIRST));
		});

		it("returns focus to the highlight after Delete note from its actions", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, SECOND));
			const deleteNote = actionOf(h, { id: SECOND, action: "highlight-panel-note-delete" });
			click(h, deleteNote);

			submit(h, { form: formIn(h, `#delete-note-highlight-${SECOND}`), submitter: deleteNote });
			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(stopOf(h, SECOND));
		});

		it("moves focus to the next highlight after a highlight is deleted, or to the previous one when it was the last", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, SECOND));
			click(h, actionOf(h, { id: SECOND, action: "highlight-panel-delete" }));
			submit(h, { form: formIn(h, `#delete-highlight-${SECOND} form`) });
			h.swap({ highlights: [THREE[0], THREE[2]] });
			const next = h.doc.activeElement === stopOf(h, THIRD);

			click(h, stopOf(h, THIRD));
			click(h, actionOf(h, { id: THIRD, action: "highlight-panel-delete" }));
			submit(h, { form: formIn(h, `#delete-highlight-${THIRD} form`) });
			h.swap({ highlights: [THREE[0]] });

			expect(next).toBe(true);
			expect(h.doc.activeElement).toBe(stopOf(h, FIRST));
		});

		it("leaves focus where a swap put it when that is not the page body", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			click(h, actionOf(h, { id: FIRST, action: "highlight-panel-note" }));
			submit(h, { form: formIn(h, `#note-highlight-${FIRST} form`) });
			h.doc.dispatchEvent(new h.window.Event("htmx:beforeSwap", { bubbles: true }));
			const outside = h.doc.getElementById("outside");
			assert(outside);
			outside.focus();

			h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle", { bubbles: true }));

			expect(h.doc.activeElement).toBe(outside);
		});

		it("leaves focus alone after a form from elsewhere is submitted while the actions handed over", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			click(h, actionOf(h, { id: FIRST, action: "highlight-panel-note" }));
			formIn(h, `#note-highlight-${FIRST} form`).querySelector("textarea")?.focus();

			submit(h, { form: formIn(h, `[data-highlight-row="${THIRD}"] .highlights-rail__delete-form--fallback`) });
			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(h.doc.body);
		});

		it("forgets the highlight to refocus when the submitted request fails without a swap", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			click(h, actionOf(h, { id: FIRST, action: "highlight-panel-note" }));
			const form = formIn(h, `#note-highlight-${FIRST} form`);
			submit(h, { form });
			form.dispatchEvent(new h.window.CustomEvent("htmx:afterRequest", { bubbles: true, detail: { successful: false } }));
			stopOf(h, THIRD).focus();

			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(stopOf(h, THIRD));
		});

		it("keeps the highlight to refocus through a request that succeeds", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			click(h, actionOf(h, { id: FIRST, action: "highlight-panel-note" }));
			const form = formIn(h, `#note-highlight-${FIRST} form`);
			submit(h, { form });
			form.dispatchEvent(new h.window.CustomEvent("htmx:afterRequest", { bubbles: true, detail: { successful: true } }));

			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(stopOf(h, FIRST));
		});

		it("keeps a rail save's focus as it is", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			click(h, actionOf(h, { id: FIRST, action: "highlight-panel-note" }));
			const railTrigger = h.doc.querySelector(`[data-highlight-row="${FIRST}"] [data-test-action="highlight-note"]`);
			assert(railTrigger, "the rail offers the note trigger");
			click(h, railTrigger);
			formIn(h, `#note-highlight-${FIRST} form`).querySelector("textarea")?.focus();

			submit(h, { form: formIn(h, `#note-highlight-${FIRST} form`) });
			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(h.doc.body);
		});
	});

	describe("focus across a swap", () => {
		it("keeps focus on a highlight across a swap", () => {
			const h = harness({ highlights: THREE });
			stopOf(h, THIRD).focus();

			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(stopOf(h, THIRD));
		});

		it("keeps focus on the highlight whose open actions held it across a swap", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));

			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(stopOf(h, FIRST));
		});

		it("forgets a focused highlight a swap removed", () => {
			const h = harness({ highlights: THREE });
			stopOf(h, THIRD).focus();

			h.swap({ highlights: [THREE[0]] });

			expect(h.doc.activeElement).toBe(h.doc.body);
		});

		it("remembers nothing when focus is elsewhere", () => {
			const h = harness({ highlights: THREE });
			click(h, stopOf(h, FIRST));
			h.open.clear();

			h.swap({ highlights: THREE });

			expect(h.doc.activeElement).toBe(h.doc.body);
		});
	});
});
