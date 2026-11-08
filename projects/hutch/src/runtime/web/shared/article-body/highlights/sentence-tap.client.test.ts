import assert from "node:assert/strict";
import { articleBody } from "@packages/test-fixtures";
import { type DOMWindow, JSDOM } from "jsdom";
import { renderReaderReady } from "../reader-slot/reader-ready.component";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../reader-slot/section-pages";
import { initHighlightToolbar, SELECTION_DEBOUNCE_MS } from "./highlight-toolbar.client";
import { renderHighlightToolbar } from "./highlight-toolbar.component";

const READER_SECTION = {
	requested: undefined,
	readerPath: "/queue/abc/view",
	thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES,
};
const CONTENT = [
	"<p>First sentence here. Second one follows</p>",
	'<p>Read <a href="#later">the link</a> now. <em>Marked words.</em></p>',
	"<p>   </p>",
	"Loose text.",
].join("");

interface Point {
	node: Node;
	offset: number;
}

interface Harness {
	doc: Document;
	window: DOMWindow;
	coarse: boolean;
	popoverOpen: boolean;
	caret: Point | null;
	submitted: HTMLFormElement[];
	runTimer(delayMs: number): void;
}

function harness(): Harness {
	const reader = renderReaderReady({
		readerSection: READER_SECTION,
		url: "https://example.com/post",
		content: articleBody(CONTENT),
		appOrigin: "https://readplace.com",
	}).html;
	const dom = new JSDOM(
		`<!doctype html><html><body><main>${renderHighlightToolbar({ scope: { articleId: "abc", readlist: [], surface: [] } })}<header><h1>Header title.</h1></header>${reader}<p id="outside">Outside the article.</p></main></body></html>`,
	);
	const doc = dom.window.document;
	const timers = new Map<number, { callback: () => void; delayMs: number }>();
	let nextHandle = 1;
	const submitted: HTMLFormElement[] = [];
	dom.window.HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement) {
		submitted.push(this);
	};
	const h: Harness = {
		doc,
		window: dom.window,
		coarse: true,
		popoverOpen: false,
		caret: null,
		submitted,
		runTimer(delayMs) {
			for (const [handle, timer] of timers) {
				if (timer.delayMs !== delayMs) continue;
				timers.delete(handle);
				timer.callback();
			}
		},
	};
	Object.defineProperty(doc, "caretRangeFromPoint", {
		value: () => (h.caret === null ? null : { startContainer: h.caret.node, startOffset: h.caret.offset }),
	});
	initHighlightToolbar({
		document: doc,
		window: {
			visualViewport: {
				width: 400,
				height: 800,
				offsetLeft: 0,
				offsetTop: 0,
				addEventListener: () => undefined,
			},
			requestAnimationFrame: () => undefined,
			matchMedia: (query) => ({
				matches: query === "(pointer: coarse)" && h.coarse,
			}),
			addEventListener: () => undefined,
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
		rectsOf: () => [{ top: 300, bottom: 320, left: 100, width: 200 }],
		isPopoverOpen: () => h.popoverOpen,
		supportsPopover: () => true,
		showPopover: () => undefined,
	});
	const marked = elementOf(h, ".article-body__content em");
	const mark = doc.createElement("mark");
	mark.dataset.highlightId = "h1";
	marked.replaceWith(mark);
	mark.append(marked);
	Object.defineProperty(toolbarOf(h), "getBoundingClientRect", {
		value: () => ({ width: 120, height: 44 }),
	});
	return h;
}

function toolbarOf(h: Harness): HTMLElement {
	const toolbar = h.doc.querySelector<HTMLElement>("[data-test-highlight-toolbar]");
	assert(toolbar);
	return toolbar;
}

function selectionOf(h: Harness): Selection {
	const selection = h.doc.getSelection();
	assert(selection);
	return selection;
}

function textNodeContaining(h: Harness, needle: string): Node {
	const walker = h.doc.createTreeWalker(h.doc.body, h.window.NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node.nodeValue?.includes(needle)) return node;
	}
	throw new Error(`no text node holds "${needle}"`);
}

function pointIn(h: Harness, needle: string): Point {
	const node = textNodeContaining(h, needle);
	return { node, offset: (node.nodeValue ?? "").indexOf(needle) };
}

function elementOf(h: Harness, selector: string): Element {
	const element = h.doc.querySelector(selector);
	assert(element, `no element matches ${selector}`);
	return element;
}

function parentOf(point: Point): Element {
	const parent = point.node.parentElement;
	assert(parent);
	return parent;
}

function tap(h: Harness, input: { target: Element; caret: Point | null }): void {
	h.caret = input.caret;
	input.target.dispatchEvent(new h.window.Event("pointerdown", { bubbles: true }));
	input.target.dispatchEvent(
		new h.window.MouseEvent("click", {
			bubbles: true,
			clientX: 10,
			clientY: 10,
		}),
	);
}

function tapText(h: Harness, needle: string): void {
	const caret = pointIn(h, needle);
	tap(h, { target: parentOf(caret), caret });
}

async function settle(h: Harness): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	h.runTimer(SELECTION_DEBOUNCE_MS);
}

function press(h: Harness): Record<string, string> {
	elementOf(h, '[data-test-action="highlight"]').dispatchEvent(new h.window.MouseEvent("click", { bubbles: true }));
	const form = h.submitted.at(-1);
	assert(form);
	return Object.fromEntries(Array.from(form.querySelectorAll("input"), (input) => [input.name, input.value]));
}

describe("initSentenceTap", () => {
	it("selects the tapped sentence on a coarse pointer and shows the bar once it rests", async () => {
		const h = harness();

		tapText(h, "follows");
		expect(selectionOf(h).toString()).toBe("Second one follows");
		expect(toolbarOf(h).hidden).toBe(true);
		await settle(h);

		expect(toolbarOf(h).hidden).toBe(false);
	});

	it("places the bar 10 px below the tapped sentence", async () => {
		const h = harness();

		tapText(h, "First");
		await settle(h);

		expect(selectionOf(h).toString()).toBe("First sentence here.");
		expect(toolbarOf(h).style.top).toBe(`${320 + 10}px`);
	});

	it("submits a tapped sentence with origin tap", async () => {
		const h = harness();
		tapText(h, "First");
		await settle(h);

		expect(press(h)).toMatchObject({
			exact: "First sentence here.",
			origin: "tap",
		});
	});

	it("submits the tapped sentence when the selection is cleared by the press itself", async () => {
		const h = harness();
		tapText(h, "First");
		await settle(h);

		selectionOf(h).removeAllRanges();

		expect(press(h)).toMatchObject({
			exact: "First sentence here.",
			origin: "tap",
		});
	});

	it("submits a widened tap with origin longpress", async () => {
		const h = harness();
		tapText(h, "First");
		await settle(h);

		const from = pointIn(h, "First");
		const to = pointIn(h, "follows");
		selectionOf(h).setBaseAndExtent(from.node, from.offset, to.node, to.offset + "follows".length);
		await settle(h);

		expect(press(h)).toMatchObject({
			exact: "First sentence here. Second one follows",
			origin: "longpress",
		});
	});

	it("leaves a fine pointer's click alone", () => {
		const h = harness();
		h.coarse = false;

		tapText(h, "First");

		expect(selectionOf(h).isCollapsed).toBe(true);
	});

	it("dismisses a live selection instead of selecting a sentence", async () => {
		const h = harness();
		const from = pointIn(h, "First");
		selectionOf(h).setBaseAndExtent(from.node, from.offset, from.node, from.offset + 5);
		await settle(h);
		const target = parentOf(from);

		target.dispatchEvent(new h.window.Event("pointerdown", { bubbles: true }));
		selectionOf(h).removeAllRanges();
		h.caret = from;
		target.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true }));
		await settle(h);

		expect(selectionOf(h).isCollapsed).toBe(true);
		expect(toolbarOf(h).hidden).toBe(true);
	});

	it.each([
		["the readlist picker", '<details class="article-body__readlists" open></details>'],
		["a nav disclosure", '<details class="nav__disclosure" open></details>'],
		["the user menu", '<details class="nav__user" open></details>'],
	])("only closes %s on a tap", (_label, overlay) => {
		const h = harness();
		h.doc.body.insertAdjacentHTML("beforeend", overlay);

		tapText(h, "First");

		expect(selectionOf(h).isCollapsed).toBe(true);
	});

	it("only closes an open popover on a tap", () => {
		const h = harness();
		h.popoverOpen = true;

		tapText(h, "First");

		expect(selectionOf(h).isCollapsed).toBe(true);
	});

	it("selects again once the overlay is closed", () => {
		const h = harness();
		h.popoverOpen = true;
		tapText(h, "First");
		h.popoverOpen = false;

		tapText(h, "First");

		expect(selectionOf(h).toString()).toBe("First sentence here.");
	});

	it.each([
		["a link", "the link"],
		["a highlight mark", "Marked"],
		["the reader's header text", "Header"],
		["text outside the article", "Outside"],
		["text directly in the content root", "Loose"],
	])("leaves a tap on %s alone", (_label, needle) => {
		const h = harness();

		tapText(h, needle);

		expect(selectionOf(h).isCollapsed).toBe(true);
	});

	it("leaves a tap alone when no caret answers the point", () => {
		const h = harness();

		tap(h, { target: parentOf(pointIn(h, "First")), caret: null });

		expect(selectionOf(h).isCollapsed).toBe(true);
	});

	it("leaves a tap alone when the caret falls outside the tapped block", () => {
		const h = harness();

		tap(h, {
			target: parentOf(pointIn(h, "First")),
			caret: pointIn(h, "now."),
		});

		expect(selectionOf(h).isCollapsed).toBe(true);
	});

	it("leaves a tap on a whitespace-only block alone", () => {
		const h = harness();
		const blank = Array.from(h.doc.querySelectorAll(".article-body__content p")).find(
			(paragraph) => paragraph.textContent === "   ",
		);
		assert(blank);
		const node = blank.firstChild;
		assert(node);

		tap(h, { target: blank, caret: { node, offset: 1 } });

		expect(selectionOf(h).isCollapsed).toBe(true);
	});
});
