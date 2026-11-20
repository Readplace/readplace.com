import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initNoteEditors, type NoteEditors } from "./note-editor.client";
import type { PassageRect } from "./place-clear-of-passage";
import { type NoteEditorPlacement, placeNoteEditor } from "./place-note-editor";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const SHEET_SPACE = "--confirm-popover-sheet-space";
const EDITOR_SIZE = { width: 400, height: 200 };
const COLUMN = { top: 0, bottom: 3000, left: 300, width: 680 };
const RAIL = { top: 80, bottom: 900, left: 1000, width: 340 };

function editPanel(id: string): string {
	return `<div id="note-highlight-${id}" popover="manual" role="dialog"><form data-highlight-note-editor><textarea name="note"></textarea></form></div>`;
}

function railRow(id: string): string {
	return `<li data-highlight-row="${id}"><blockquote class="highlights-rail__excerpt">Quote ${id}</blockquote><button type="button" popovertarget="note-highlight-${id}" data-rail-trigger="${id}">Note</button></li>`;
}

const PAGE = `<main>
<div class="article-body__content"><p>Alpha <mark class="article-highlight" data-highlight-id="${FIRST}">beta</mark> gamma <mark class="article-highlight" data-highlight-id="${SECOND}">delta</mark>.</p></div>
<div id="manage-highlight-${FIRST}" popover><button type="button" popovertarget="note-highlight-${FIRST}" data-panel-trigger>Edit note</button></div>
<div id="highlight-note-create" popover="manual" role="dialog"><form data-highlight-note-editor><textarea name="note"></textarea></form></div>
<section class="highlights-rail"><ol>${railRow(FIRST)}${railRow(SECOND)}</ol></section>
<a class="reading-layout__top" href="#top">Top</a>
${editPanel(FIRST)}${editPanel(SECOND)}
</main>`;

interface Harness {
	doc: Document;
	window: JSDOM["window"];
	editors: NoteEditors;
	log: string[];
	scrolls: number[];
	frames: number;
	autoOpen: boolean;
	chromeBottom: number;
	viewport: {
		width: number;
		height: number;
		offsetLeft: number;
		offsetTop: number;
	};
	rects: Map<Node, PassageRect[]>;
	createRange: Range;
	resize(): void;
}

function harness(): Harness {
	const dom = new JSDOM(`<!doctype html><html><body>${PAGE}</body></html>`);
	const doc = dom.window.document;
	const resizeListeners: (() => void)[] = [];
	const createRange = doc.createRange();
	const h: Harness = {
		doc,
		window: dom.window,
		editors: {
			openCreate: () => undefined,
			isOpen: () => false,
			reposition: () => undefined,
		},
		log: [],
		scrolls: [],
		frames: 0,
		autoOpen: false,
		chromeBottom: 64,
		viewport: { width: 1440, height: 900, offsetLeft: 0, offsetTop: 0 },
		rects: new Map(),
		createRange,
		resize: () => {
			for (const listener of resizeListeners) listener();
		},
	};
	const sized = (selector: string, rect: PassageRect): void => {
		for (const element of doc.querySelectorAll(selector)) {
			Object.defineProperty(element, "getBoundingClientRect", {
				value: () => ({ ...rect, height: rect.bottom - rect.top }),
				configurable: true,
			});
		}
	};
	sized("[popover][role=dialog]", {
		top: 0,
		bottom: EDITOR_SIZE.height,
		left: 0,
		width: EDITOR_SIZE.width,
	});
	sized(".article-body__content", COLUMN);
	sized(".highlights-rail", RAIL);
	sized(".reading-layout__top", {
		top: 820,
		bottom: 860,
		left: 1300,
		width: 60,
	});
	h.rects.set(doc, [ON_SCREEN_MARK]);
	for (const quote of doc.querySelectorAll("[data-highlight-row] blockquote")) {
		h.rects.set(quote, [ON_SCREEN_QUOTE]);
	}
	h.editors = initNoteEditors({
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
				addEventListener: (_type, listener) => resizeListeners.push(listener),
			},
			scrollBy: (options) => h.scrolls.push(options.top),
		},
		rectsOf: (range) =>
			h.rects.get(range === createRange ? doc : range.startContainer) ?? [],
		hidePopover: (panel) => h.log.push(`hide ${panel.id}`),
		isAutoPopoverOpen: () => h.autoOpen,
		paintDraft: (range) =>
			h.log.push(range === createRange ? "paint create" : "paint other"),
		clearDraft: () => h.log.push("clear"),
		chromeBottom: () => h.chromeBottom,
		hideOtherSurfaces: () => h.log.push("others"),
		requestReposition: () => {
			h.frames += 1;
		},
	});
	return h;
}

function element(h: Harness, selector: string): HTMLElement {
	const found = h.doc.querySelector<HTMLElement>(selector);
	assert(found, `the page holds ${selector}`);
	return found;
}

const markOf = (h: Harness, id: string): HTMLElement =>
	element(h, `mark[data-highlight-id="${id}"]`);
const quoteOf = (h: Harness, id: string): HTMLElement =>
	element(h, `[data-highlight-row="${id}"] blockquote`);
const panelOf = (h: Harness, id: string): HTMLElement =>
	element(h, `#note-highlight-${id}`);
const createPanel = (h: Harness): HTMLElement =>
	element(h, "#highlight-note-create");

function toggle(
	h: Harness,
	input: {
		panel: Element;
		type: "beforetoggle" | "toggle";
		newState: "open" | "closed";
	},
): void {
	input.panel.dispatchEvent(
		Object.assign(new h.window.Event(input.type), { newState: input.newState }),
	);
}

function openEdit(
	h: Harness,
	input: { id: string; from: "rail" | "panel" },
): void {
	const trigger =
		input.from === "rail"
			? element(h, `[data-rail-trigger="${input.id}"]`)
			: element(h, "[data-panel-trigger]");
	trigger.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true }));
	toggle(h, {
		panel: panelOf(h, input.id),
		type: "beforetoggle",
		newState: "open",
	});
	h.editors.reposition();
}

function openCreate(h: Harness): void {
	h.editors.openCreate({
		panel: createPanel(h),
		range: h.createRange,
		show: () => h.log.push("show create"),
	});
}

function expected(
	h: Harness,
	input: {
		rects: PassageRect[];
		trigger: Parameters<typeof placeNoteEditor>[0]["trigger"];
	},
): NoteEditorPlacement {
	return placeNoteEditor({
		rects: input.rects,
		editor: EDITOR_SIZE,
		viewport: { ...h.viewport },
		topInset: h.chromeBottom,
		column: { left: COLUMN.left, width: COLUMN.width },
		chrome: [RAIL, { top: 820, bottom: 860, left: 1300, width: 60 }],
		trigger: input.trigger,
	});
}

function placed(panel: HTMLElement): Record<string, string> {
	const { top, left, width, bottom, right, margin, maxHeight } = panel.style;
	return { top, left, width, bottom, right, margin, maxHeight };
}

function styleOf(placement: NoteEditorPlacement): Record<string, string> {
	return {
		top: `${placement.top}px`,
		left: `${placement.left}px`,
		width: `${placement.width}px`,
		bottom: "auto",
		right: "auto",
		margin: "0px",
		maxHeight:
			placement.maxHeight === undefined ? "" : `${placement.maxHeight}px`,
	};
}

function sheetSpace(h: Harness): string {
	return h.doc.documentElement.style.getPropertyValue(SHEET_SPACE);
}

const ON_SCREEN_MARK: PassageRect = {
	top: 400,
	bottom: 420,
	left: 340,
	width: 60,
};
const ON_SCREEN_QUOTE: PassageRect = {
	top: 300,
	bottom: 360,
	left: 1020,
	width: 300,
};

describe("initNoteEditors", () => {
	describe("the create editor", () => {
		it("hides the other surfaces, paints the toolbar's range, shows, then places before it returns", () => {
			const h = harness();
			h.rects.set(h.doc, [ON_SCREEN_MARK]);

			openCreate(h);

			expect(h.log).toEqual(["others", "paint create", "show create"]);
			expect(placed(createPanel(h))).toEqual(
				styleOf(
					expected(h, { rects: [ON_SCREEN_MARK], trigger: { reason: "open" } }),
				),
			);
			expect(sheetSpace(h)).toBe("0px");
			expect(h.editors.isOpen()).toBe(true);
		});
	});

	describe("an edit editor", () => {
		it("places nothing until the frame, then keeps clear of the marks and the quote both on screen", () => {
			const h = harness();
			h.rects.set(markOf(h, FIRST), [ON_SCREEN_MARK]);
			h.rects.set(quoteOf(h, FIRST), [ON_SCREEN_QUOTE]);
			element(h, `[data-rail-trigger="${FIRST}"]`).dispatchEvent(
				new h.window.MouseEvent("click", { bubbles: true }),
			);
			toggle(h, {
				panel: panelOf(h, FIRST),
				type: "beforetoggle",
				newState: "open",
			});

			expect({
				frames: h.frames,
				top: panelOf(h, FIRST).style.top,
				log: h.log,
			}).toEqual({ frames: 1, top: "", log: ["others"] });
			h.editors.reposition();

			expect(placed(panelOf(h, FIRST))).toEqual(
				styleOf(
					expected(h, {
						rects: [ON_SCREEN_MARK, ON_SCREEN_QUOTE],
						trigger: { reason: "open" },
					}),
				),
			);
		});

		it("keeps clear of the quote alone when the marks are off screen", () => {
			const h = harness();
			h.rects.set(markOf(h, FIRST), [
				{ top: 2400, bottom: 2420, left: 340, width: 60 },
			]);
			h.rects.set(quoteOf(h, FIRST), [ON_SCREEN_QUOTE]);

			openEdit(h, { id: FIRST, from: "rail" });

			expect(placed(panelOf(h, FIRST))).toEqual(
				styleOf(
					expected(h, {
						rects: [ON_SCREEN_QUOTE],
						trigger: { reason: "open" },
					}),
				),
			);
		});

		it.each([
			{ from: "rail" as const, passage: "quote" },
			{ from: "panel" as const, passage: "marks" },
		])("with nothing on screen, opened from the $from, scrolls to the $passage", ({
			from,
			passage,
		}) => {
			const h = harness();
			const markRect = { top: 2400, bottom: 2420, left: 340, width: 60 };
			const quoteRect = { top: -900, bottom: -840, left: 1020, width: 300 };
			h.rects.set(markOf(h, FIRST), [markRect]);
			h.rects.set(quoteOf(h, FIRST), [quoteRect]);

			openEdit(h, { id: FIRST, from });

			const placement = expected(h, {
				rects: [passage === "quote" ? quoteRect : markRect],
				trigger: { reason: "open" },
			});
			expect({ style: placed(panelOf(h, FIRST)), scrolls: h.scrolls }).toEqual({
				style: styleOf(placement),
				scrolls: [placement.scrollBy],
			});
		});

		it("ignores a panel that no rail row opens", () => {
			const h = harness();

			toggle(h, {
				panel: createPanel(h),
				type: "beforetoggle",
				newState: "open",
			});

			expect({
				frames: h.frames,
				open: h.editors.isOpen(),
				log: h.log,
			}).toEqual({ frames: 0, open: false, log: [] });
		});

		it("ignores a panel closing before it opens", () => {
			const h = harness();

			toggle(h, {
				panel: panelOf(h, FIRST),
				type: "beforetoggle",
				newState: "closed",
			});

			expect({ frames: h.frames, open: h.editors.isOpen() }).toEqual({
				frames: 0,
				open: false,
			});
		});
	});

	describe("Escape", () => {
		const pressEscape = (h: Harness, init: KeyboardEventInit = {}): void => {
			h.doc.dispatchEvent(
				new h.window.KeyboardEvent("keydown", { key: "Escape", ...init }),
			);
		};

		it("hides the open editor once", () => {
			const h = harness();
			openEdit(h, { id: FIRST, from: "rail" });
			h.log.length = 0;

			pressEscape(h);

			expect(h.log).toEqual([`hide note-highlight-${FIRST}`]);
		});

		it("leaves the editor to the browser while an auto popover is open over it, or while composing", () => {
			const h = harness();
			openEdit(h, { id: FIRST, from: "rail" });
			h.log.length = 0;

			h.autoOpen = true;
			pressEscape(h);
			h.autoOpen = false;
			pressEscape(h, { isComposing: true });
			h.doc.dispatchEvent(
				new h.window.KeyboardEvent("keydown", { key: "Enter" }),
			);

			expect(h.log).toEqual([]);
		});

		it("does nothing with no editor open", () => {
			const h = harness();

			pressEscape(h);

			expect(h.log).toEqual([]);
		});
	});

	describe("one editor at a time", () => {
		it("opening a second editor hides the first and the other surfaces", () => {
			const h = harness();
			openEdit(h, { id: FIRST, from: "rail" });
			h.log.length = 0;

			openEdit(h, { id: SECOND, from: "rail" });

			expect(h.log).toEqual(["others", `hide note-highlight-${FIRST}`]);
		});

		it("keeps the second editor's space and passage when the first one's close arrives late", () => {
			const h = harness();
			h.viewport = { width: 412, height: 400, offsetLeft: 0, offsetTop: 0 };
			h.rects.set(quoteOf(h, SECOND), [
				{ top: 120, bottom: 300, left: 16, width: 380 },
			]);
			openEdit(h, { id: FIRST, from: "rail" });
			openEdit(h, { id: SECOND, from: "rail" });
			const space = sheetSpace(h);
			h.log.length = 0;

			toggle(h, {
				panel: panelOf(h, FIRST),
				type: "toggle",
				newState: "closed",
			});
			h.rects.set(quoteOf(h, SECOND), [
				{ top: 100, bottom: 280, left: 16, width: 380 },
			]);
			h.editors.reposition();

			const first = expected(h, {
				rects: [{ top: 120, bottom: 300, left: 16, width: 380 }],
				trigger: { reason: "open" },
			});
			expect({ space, log: h.log, style: placed(panelOf(h, SECOND)) }).toEqual({
				space: `${first.bottomSpace}px`,
				log: [],
				style: styleOf(
					expected(h, {
						rects: [{ top: 100, bottom: 280, left: 16, width: 380 }],
						trigger: { reason: "scroll", mode: first.mode },
					}),
				),
			});
			expect(sheetSpace(h)).toBe(space);
		});

		it("clears the tint once when an edit editor takes over from the create editor", () => {
			const h = harness();
			h.rects.set(quoteOf(h, FIRST), [ON_SCREEN_QUOTE]);
			openCreate(h);
			openEdit(h, { id: FIRST, from: "rail" });

			toggle(h, { panel: createPanel(h), type: "toggle", newState: "closed" });

			expect(h.log.filter((entry) => entry === "clear")).toEqual(["clear"]);
			expect(h.log).toContain("hide highlight-note-create");
			expect({
				open: h.editors.isOpen(),
				style: placed(panelOf(h, FIRST)),
			}).toEqual({
				open: true,
				style: styleOf(
					expected(h, {
						rects: [ON_SCREEN_QUOTE],
						trigger: { reason: "open" },
					}),
				),
			});
		});
	});

	describe("closing", () => {
		it("clears the tint and the bottom space when the open editor closes", () => {
			const h = harness();
			openCreate(h);
			h.log.length = 0;

			toggle(h, { panel: createPanel(h), type: "toggle", newState: "closed" });

			expect({
				log: h.log,
				space: sheetSpace(h),
				open: h.editors.isOpen(),
			}).toEqual({ log: ["clear"], space: "", open: false });
		});

		it("forgets an editor whose panel left the page", () => {
			const h = harness();
			openCreate(h);
			h.log.length = 0;

			createPanel(h).remove();

			expect({
				open: h.editors.isOpen(),
				log: h.log,
				space: sheetSpace(h),
			}).toEqual({ open: false, log: ["clear"], space: "" });
		});

		it("after a settle that removed the panel, clears the tint and the bottom space", () => {
			const h = harness();
			openCreate(h);
			createPanel(h).remove();
			h.log.length = 0;

			h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle"));

			expect({ log: h.log, space: sheetSpace(h) }).toEqual({
				log: ["clear"],
				space: "",
			});
		});

		it("after a settle with the panel still open, re-places it and keeps the tint", () => {
			const h = harness();
			h.rects.set(h.doc, [ON_SCREEN_MARK]);
			openCreate(h);
			h.log.length = 0;
			h.rects.set(h.doc, [{ top: 500, bottom: 520, left: 340, width: 60 }]);

			h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle"));

			expect({ log: h.log, style: placed(createPanel(h)) }).toEqual({
				log: [],
				style: styleOf(
					expected(h, {
						rects: [{ top: 500, bottom: 520, left: 340, width: 60 }],
						trigger: { reason: "resize" },
					}),
				),
			});
		});

		it("re-places nothing on a frame with no editor open", () => {
			const h = harness();

			h.editors.reposition();
			h.resize();

			expect({ log: h.log, scrolls: h.scrolls }).toEqual({
				log: [],
				scrolls: [],
			});
		});
	});

	describe("following the passage", () => {
		it("keeps the mode on a scroll", () => {
			const h = harness();
			h.rects.set(h.doc, [ON_SCREEN_MARK]);
			openCreate(h);
			const first = expected(h, {
				rects: [ON_SCREEN_MARK],
				trigger: { reason: "open" },
			});
			h.rects.set(h.doc, [{ top: 150, bottom: 170, left: 340, width: 60 }]);

			h.editors.reposition();

			expect(placed(createPanel(h))).toEqual(
				styleOf(
					expected(h, {
						rects: [{ top: 150, bottom: 170, left: 340, width: 60 }],
						trigger: { reason: "scroll", mode: first.mode },
					}),
				),
			);
		});

		it("switches to the sheet and scrolls the exact distance when the keyboard opens over the field", () => {
			const h = harness();
			h.viewport = { width: 412, height: 800, offsetLeft: 0, offsetTop: 0 };
			const passage = { top: 420, bottom: 600, left: 16, width: 380 };
			h.rects.set(h.doc, [passage]);
			openCreate(h);
			element(h, "#highlight-note-create textarea").focus();

			h.viewport = { width: 412, height: 420, offsetLeft: 0, offsetTop: 0 };
			h.resize();
			h.editors.reposition();

			const keyboard = expected(h, {
				rects: [passage],
				trigger: { reason: "keyboard" },
			});
			expect(keyboard.mode).toBe("sheet");
			expect({
				space: sheetSpace(h),
				scrolls: h.scrolls,
				style: placed(createPanel(h)),
			}).toEqual({
				space: `${keyboard.bottomSpace}px`,
				scrolls: [keyboard.scrollBy],
				style: styleOf(keyboard),
			});
		});

		it("re-places without scrolling for an address bar resize with focus outside the field", () => {
			const h = harness();
			h.viewport = { width: 412, height: 800, offsetLeft: 0, offsetTop: 0 };
			const passage = { top: 520, bottom: 560, left: 16, width: 380 };
			h.rects.set(h.doc, [passage]);
			openCreate(h);

			h.viewport = { width: 412, height: 744, offsetLeft: 0, offsetTop: 0 };
			h.resize();
			h.editors.reposition();

			expect({ scrolls: h.scrolls, style: placed(createPanel(h)) }).toEqual({
				scrolls: [],
				style: styleOf(
					expected(h, { rects: [passage], trigger: { reason: "resize" } }),
				),
			});
		});
	});
});
