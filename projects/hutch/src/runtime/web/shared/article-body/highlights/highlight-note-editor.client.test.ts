import assert from "node:assert/strict";
import { type DOMWindow, JSDOM } from "jsdom";
import { initHighlightNoteEditors } from "./highlight-note-editor.client";
import type { PassageRect } from "./place-clear-of-passage";

const EDITOR_SIZE = { width: 400, height: 200 };
const PASSAGE: PassageRect = { top: 300, bottom: 320, left: 500, width: 200 };

function editorHtml(input: { id: string; highlightId: string; quote: string }): string {
	return `<div class="highlight-note-editor" id="${input.id}" popover="auto" role="dialog" data-highlight-note-editor="${input.highlightId}"><blockquote data-highlight-note-quote>${input.quote}</blockquote><form><textarea name="note"></textarea></form></div>`;
}

const PAGE = [
	'<p><mark class="article-highlight" data-highlight-id="h1">Alpha</mark> beta <span id="selected">gamma</span></p>',
	editorHtml({ id: "note-highlight-h1", highlightId: "h1", quote: "Alpha" }),
	editorHtml({ id: "note-highlight-gone", highlightId: "gone", quote: "Lost" }),
	editorHtml({ id: "note-highlight-dialog", highlightId: "", quote: "" }),
	'<div id="other" popover="auto"></div>',
].join("");

interface Harness {
	doc: Document;
	window: DOMWindow;
	rects: PassageRect[];
	viewport: { width: number; height: number; offsetLeft: number; offsetTop: number };
	measured: Range[];
	open: Set<Element>;
	scheduled: number;
	resize(): void;
	editors: ReturnType<typeof initHighlightNoteEditors>;
}

function harness(page: string = PAGE): Harness {
	const dom = new JSDOM(`<!doctype html><html><body><main>${page}</main></body></html>`);
	const doc = dom.window.document;
	for (const editor of Array.from(doc.querySelectorAll("[data-highlight-note-editor]"))) {
		Object.defineProperty(editor, "getBoundingClientRect", { value: () => EDITOR_SIZE, configurable: true });
	}
	const resizeListeners: (() => void)[] = [];
	const h: Harness = {
		doc,
		window: dom.window,
		rects: [PASSAGE],
		viewport: { width: 1000, height: 800, offsetLeft: 0, offsetTop: 0 },
		measured: [],
		open: new Set(),
		scheduled: 0,
		resize: () => {
			for (const listener of resizeListeners) listener();
		},
		editors: { reposition: () => undefined, isOpen: () => false, handOver: () => undefined },
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
		addEventListener: (_type: "resize", listener: () => void) => {
			resizeListeners.push(listener);
		},
	};
	h.editors = initHighlightNoteEditors({
		document: doc,
		window: { visualViewport: viewport },
		rectsOf: (range) => {
			h.measured.push(range);
			return h.rects;
		},
		isOpen: (popover) => h.open.has(popover),
		schedule: () => {
			h.scheduled += 1;
		},
	});
	return h;
}

function editorOf(h: Harness, id: string): HTMLElement {
	const editor = h.doc.getElementById(id);
	assert(editor instanceof h.window.HTMLElement, `the page renders ${id}`);
	return editor;
}

function toggle(h: Harness, input: { target: EventTarget; newState: "open" | "closed" }): void {
	const event = new h.window.Event("beforetoggle");
	Object.defineProperty(event, "newState", { value: input.newState });
	input.target.dispatchEvent(event);
}

function openEditor(h: Harness, id: string): HTMLElement {
	const editor = editorOf(h, id);
	toggle(h, { target: editor, newState: "open" });
	h.open.add(editor);
	h.editors.reposition();
	return editor;
}

function placed(editor: HTMLElement): { top: string; left: string } {
	assert.equal(editor.style.bottom, "auto", "a placed editor lets go of the stylesheet's bottom");
	return { top: editor.style.top, left: editor.style.left };
}

const ABOVE = { top: `${300 - 10 - 200}px`, left: `${500 + 100 - 200}px` };
const DOCKED = { top: `${800 - 16 - 200}px`, left: `${(1000 - 400) / 2}px` };

describe("initHighlightNoteEditors", () => {
	it("schedules a reposition when an editor opens and places it above its highlight's marks", () => {
		const h = harness();

		toggle(h, { target: editorOf(h, "note-highlight-h1"), newState: "open" });
		expect(h.scheduled).toBe(1);
		const editor = openEditor(h, "note-highlight-h1");

		expect(placed(editor)).toEqual(ABOVE);
		expect(editor.style.maxHeight).toBe(`${800 - 32}px`);
		expect(h.measured.map((range) => range.toString())).toEqual(["Alpha"]);
	});

	it("places the editor below the passage when it does not fit above", () => {
		const h = harness();
		h.rects = [{ ...PASSAGE, top: 100, bottom: 120 }];

		const editor = openEditor(h, "note-highlight-h1");

		expect(placed(editor)).toEqual({ top: `${120 + 10}px`, left: ABOVE.left });
	});

	it("docks the editor centred at the bottom of the visual viewport when neither side fits", () => {
		const h = harness();
		h.rects = [{ ...PASSAGE, top: 150, bottom: 650 }];

		const editor = openEditor(h, "note-highlight-h1");

		expect(placed(editor)).toEqual(DOCKED);
	});

	it("docks the editor of a highlight with no marks inside a zoomed visual viewport", () => {
		const h = harness();
		h.viewport = { width: 600, height: 500, offsetLeft: 50, offsetTop: 100 };

		const editor = openEditor(h, "note-highlight-gone");

		expect(placed(editor)).toEqual({ top: `${100 + 500 - 16 - 200}px`, left: `${50 + 100}px` });
		expect(editor.style.maxHeight).toBe(`${500 - 32}px`);
		expect(h.measured).toEqual([]);
	});

	it.each([
		["above", { ...PASSAGE, top: -40, bottom: 0 }],
		["below", { ...PASSAGE, top: 800, bottom: 820 }],
		["left of", { ...PASSAGE, left: -200, width: 200 }],
		["right of", { ...PASSAGE, left: 1000 }],
	])("docks the editor when its passage lies wholly %s the visual viewport", (_where, rect) => {
		const h = harness();
		h.rects = [rect];

		const editor = openEditor(h, "note-highlight-h1");

		expect(placed(editor)).toEqual(DOCKED);
	});

	it("places the toolbar's editor by the range handed over and shows the handed quote", () => {
		const h = harness();
		const range = h.doc.createRange();
		const selected = h.doc.getElementById("selected");
		assert(selected);
		range.selectNodeContents(selected);

		h.editors.handOver({ range, quote: "gamma" });
		const editor = openEditor(h, "note-highlight-dialog");

		expect(editor.querySelector("[data-highlight-note-quote]")?.textContent).toBe("gamma");
		expect(h.measured).toEqual([range]);
		expect(placed(editor)).toEqual(ABOVE);
	});

	it("docks the toolbar's editor when no range was handed over", () => {
		const h = harness();

		const editor = openEditor(h, "note-highlight-dialog");

		expect(placed(editor)).toEqual(DOCKED);
		expect(h.measured).toEqual([]);
	});

	it("refuses a hand-over on a page without the toolbar's editor", () => {
		const h = harness(editorHtml({ id: "note-highlight-h1", highlightId: "h1", quote: "Alpha" }));

		expect(() => h.editors.handOver({ range: h.doc.createRange(), quote: "gamma" })).toThrow(
			"the toolbar's note editor carries its quote",
		);
	});

	it("follows the passage on its side as the page scrolls, even off screen", () => {
		const h = harness();
		const editor = openEditor(h, "note-highlight-h1");

		h.rects = [{ ...PASSAGE, top: 400, bottom: 420 }];
		h.editors.reposition();
		expect(placed(editor)).toEqual({ top: `${400 - 210}px`, left: ABOVE.left });

		h.rects = [{ ...PASSAGE, top: -100, bottom: -80 }];
		h.editors.reposition();
		expect(placed(editor)).toEqual({ top: `${-100 - 210}px`, left: ABOVE.left });

		h.rects = [PASSAGE];
		h.editors.reposition();
		expect(placed(editor)).toEqual(ABOVE);
	});

	it("picks a side again when its side stops fitting while the passage is on screen", () => {
		const h = harness();
		const editor = openEditor(h, "note-highlight-h1");

		h.rects = [{ ...PASSAGE, top: 100, bottom: 120 }];
		h.editors.reposition();

		expect(placed(editor)).toEqual({ top: `${120 + 10}px`, left: ABOVE.left });
	});

	it("docks when the highlight's marks are gone", () => {
		const h = harness();
		const editor = openEditor(h, "note-highlight-h1");

		h.doc.querySelector("mark")?.remove();
		h.editors.reposition();

		expect(placed(editor)).toEqual(DOCKED);
	});

	it("stays docked on scroll once docked, and picks again on a viewport resize", () => {
		const h = harness();
		h.rects = [{ ...PASSAGE, top: 150, bottom: 650 }];
		const editor = openEditor(h, "note-highlight-h1");

		h.rects = [PASSAGE];
		h.editors.reposition();
		expect(placed(editor)).toEqual(DOCKED);

		h.resize();
		h.editors.reposition();
		expect(placed(editor)).toEqual(ABOVE);
	});

	it("picks again and schedules a reposition once a swap settles", () => {
		const h = harness();
		h.rects = [{ ...PASSAGE, top: 150, bottom: 650 }];
		const editor = openEditor(h, "note-highlight-h1");
		h.rects = [PASSAGE];

		h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle", { bubbles: true }));
		expect(h.scheduled).toBe(2);
		h.editors.reposition();

		expect(placed(editor)).toEqual(ABOVE);
	});

	it("is open while an editor is open, and forgets one that closed or left the page", () => {
		const h = harness();
		const editor = openEditor(h, "note-highlight-h1");
		expect(h.editors.isOpen()).toBe(true);

		h.open.delete(editor);
		expect(h.editors.isOpen()).toBe(false);
		h.rects = [{ ...PASSAGE, top: 400, bottom: 420 }];
		h.editors.reposition();
		expect(placed(editor)).toEqual(ABOVE);

		const again = openEditor(h, "note-highlight-gone");
		again.remove();
		expect(h.editors.isOpen()).toBe(false);
	});

	it("ignores a closing editor, other popovers, the document, a resize and a settle with nothing open", () => {
		const h = harness();

		toggle(h, { target: editorOf(h, "note-highlight-h1"), newState: "closed" });
		toggle(h, { target: editorOf(h, "other"), newState: "open" });
		toggle(h, { target: h.doc, newState: "open" });
		h.resize();
		h.doc.dispatchEvent(new h.window.Event("htmx:afterSettle", { bubbles: true }));
		h.editors.reposition();

		expect(h.scheduled).toBe(1);
		expect(h.editors.isOpen()).toBe(false);
		expect(editorOf(h, "note-highlight-h1").style.top).toBe("");
		expect(editorOf(h, "note-highlight-h1").style.bottom).toBe("");
	});
});
