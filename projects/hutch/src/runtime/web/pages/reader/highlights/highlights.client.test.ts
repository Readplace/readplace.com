import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	anchorFromRange,
	type HighlightsClientDeps,
	initHighlights,
	readPanelEntries,
	selectionButtonPosition,
	type SelectionLike,
	textSegmentsInRange,
	wrapHighlight,
} from "./highlights.client";

function bodyDoc(inner: string): Document {
	return new JSDOM(
		`<!doctype html><html><body class="article-body__content">${inner}</body></html>`,
	).window.document;
}

function childOf(node: Node): Node {
	const child = node.firstChild;
	assert(child, "expected a child node");
	return child;
}

function rangeOver(doc: Document, node: Node, start: number, end: number): Range {
	const range = doc.createRange();
	range.setStart(node, start);
	range.setEnd(node, end);
	// JSDOM does not lay out content, so stub the geometry the button positioner reads.
	Object.defineProperty(range, "getBoundingClientRect", {
		value: () => ({ left: 0, bottom: 0 }),
		configurable: true,
	});
	return range;
}

describe("anchorFromRange", () => {
	it("returns undefined for a collapsed selection", () => {
		const doc = bodyDoc("<p>Hello</p>");
		const text = childOf(childOf(doc.body));
		expect(anchorFromRange(doc.body, rangeOver(doc, text, 2, 2))).toBeUndefined();
	});

	it("returns undefined when the selection escapes the root", () => {
		const doc = bodyDoc("<p>Hello world</p>");
		const text = childOf(childOf(doc.body));
		const detachedRoot = doc.createElement("div");
		expect(anchorFromRange(detachedRoot, rangeOver(doc, text, 0, 5))).toBeUndefined();
	});

	it("returns undefined for a whitespace-only selection", () => {
		const doc = bodyDoc("<p>   </p>");
		const text = childOf(childOf(doc.body));
		expect(anchorFromRange(doc.body, rangeOver(doc, text, 0, 3))).toBeUndefined();
	});

	it("derives a character anchor from a selection at the start", () => {
		const doc = bodyDoc("<p>Hello world</p>");
		const text = childOf(childOf(doc.body));
		expect(anchorFromRange(doc.body, rangeOver(doc, text, 0, 5))).toEqual({
			start: 0,
			end: 5,
			quote: "Hello",
		});
	});

	it("derives a character anchor from a selection offset into the text", () => {
		const doc = bodyDoc("<p>Hello world</p>");
		const text = childOf(childOf(doc.body));
		expect(anchorFromRange(doc.body, rangeOver(doc, text, 6, 11))).toEqual({
			start: 6,
			end: 11,
			quote: "world",
		});
	});
});

describe("textSegmentsInRange", () => {
	it("splits a range that spans several text nodes", () => {
		const doc = bodyDoc("<p>Hello <b>brave</b> world</p>");
		const segments = textSegmentsInRange(doc.body, 4, 13);
		expect(segments.length).toBe(3);
		expect(segments.map((s) => s.node.data.slice(s.from, s.to)).join("")).toBe("o brave w");
	});

	it("returns only the overlapping nodes", () => {
		const doc = bodyDoc("<p>Hello <b>brave</b> world</p>");
		expect(textSegmentsInRange(doc.body, 0, 3).length).toBe(1);
	});
});

describe("wrapHighlight", () => {
	it("wraps a range in the middle of a text node, preserving surrounding text", () => {
		const doc = bodyDoc("<p>Hello world</p>");
		wrapHighlight(doc, doc.body, { id: "h1", start: 6, end: 8, quote: "wo" });
		const mark = doc.querySelector("mark.rp-highlight");
		assert(mark, "mark must be inserted");
		expect(mark.getAttribute("data-rp-highlight-id")).toBe("h1");
		expect(mark.textContent).toBe("wo");
		expect(doc.body.textContent).toBe("Hello world");
	});

	it("wraps a range at the very start of a text node", () => {
		const doc = bodyDoc("<p>Hello world</p>");
		wrapHighlight(doc, doc.body, { id: "h1", start: 0, end: 5, quote: "Hello" });
		expect(doc.querySelector("mark.rp-highlight")?.textContent).toBe("Hello");
	});

	it("wraps a range at the very end of a text node", () => {
		const doc = bodyDoc("<p>Hello world</p>");
		wrapHighlight(doc, doc.body, { id: "h1", start: 6, end: 11, quote: "world" });
		expect(doc.querySelector("mark.rp-highlight")?.textContent).toBe("world");
		expect(doc.body.textContent).toBe("Hello world");
	});

	it("wraps each crossed text node when the range spans elements", () => {
		const doc = bodyDoc("<p>a<b>bc</b>d</p>");
		wrapHighlight(doc, doc.body, { id: "h1", start: 0, end: 4, quote: "abcd" });
		expect(doc.querySelectorAll("mark.rp-highlight").length).toBe(3);
		expect(doc.body.textContent).toBe("abcd");
	});

	it("skips the highlight when the anchored text no longer matches the stored quote", () => {
		const doc = bodyDoc("<p>Hello world</p>");
		// Article changed: the offsets now cover "wo", not the stored "ZZ".
		wrapHighlight(doc, doc.body, { id: "h1", start: 6, end: 8, quote: "ZZ" });
		expect(doc.querySelectorAll("mark.rp-highlight").length).toBe(0);
		expect(doc.body.textContent).toBe("Hello world");
	});
});

describe("selectionButtonPosition", () => {
	it("offsets the selection rectangle by the iframe position and scroll", () => {
		expect(
			selectionButtonPosition({
				selectionRect: { left: 10, bottom: 20 },
				iframeRect: { left: 100, top: 200 },
				scrollX: 5,
				scrollY: 7,
			}),
		).toEqual({ left: 115, top: 233 });
	});
});

describe("readPanelEntries", () => {
	it("reads well-formed items and skips malformed ones", () => {
		const doc = new JSDOM(`<div data-highlights-panel>
			<div data-highlights-item data-rp-highlight-id="id1" data-rp-start="0" data-rp-end="5" data-rp-quote="Hello"></div>
			<div data-highlights-item data-rp-highlight-id="id2" data-rp-start="bad" data-rp-end="9" data-rp-quote="x"></div>
			<div data-highlights-item data-rp-start="1" data-rp-end="2" data-rp-quote="x"></div>
			<div data-highlights-item data-rp-highlight-id="id4" data-rp-start="1" data-rp-end="2"></div>
		</div>`).window.document;
		const panel = doc.querySelector("[data-highlights-panel]");
		assert(panel, "panel");
		expect(readPanelEntries(panel)).toEqual([{ id: "id1", start: 0, end: 5, quote: "Hello" }]);
	});
});

const CREATE_FORM = `<form data-highlights-create-form action="/queue/abc/highlights"><input type="hidden" name="start"><input type="hidden" name="end"><input type="hidden" name="quote"></form>`;
const PANEL_WITH_HIGHLIGHT = `<div data-highlights-panel data-highlights-count="1"><div data-highlights-item data-rp-highlight-id="h1" data-rp-start="0" data-rp-end="5" data-rp-quote="Hello"></div>${CREATE_FORM}</div>`;
const EMPTY_PANEL = `<div data-highlights-panel data-highlights-count="0">${CREATE_FORM}</div>`;
const IFRAME = `<iframe data-reader-iframe></iframe>`;
const ARTICLE = `<html><body class="article-body__content"><p>Hello world</p></body></html>`;

interface InitHarness {
	parent: JSDOM;
	deps: HighlightsClientDeps;
	submittedForms: HTMLFormElement[];
	setSelection: (selection: SelectionLike | null) => void;
	fireSwap: () => void;
	button: () => HTMLButtonElement;
}

function makeInitHarness(panelHtml: string, iframeHtml: string): InitHarness {
	const parent = new JSDOM(`<!doctype html><html><body>${panelHtml}${iframeHtml}</body></html>`);
	const submittedForms: HTMLFormElement[] = [];
	const swapListeners: Array<() => void> = [];
	let selection: SelectionLike | null = null;
	const deps: HighlightsClientDeps = {
		document: parent.window.document,
		getSelection: () => selection,
		submitForm: (form) => submittedForms.push(form),
		addSwapListener: (listener) => swapListeners.push(listener),
	};
	return {
		parent,
		deps,
		submittedForms,
		setSelection: (next) => {
			selection = next;
		},
		fireSwap: () => {
			for (const listener of swapListeners) listener();
		},
		button: () => {
			const el = parent.window.document.querySelector<HTMLButtonElement>(".rp-highlight-button");
			assert(el, "highlight button must be present in the document");
			return el;
		},
	};
}

function attachInner(
	parent: JSDOM,
	innerHtml: string,
	readyState: "complete" | "loading" = "complete",
): { iframe: HTMLIFrameElement; innerDoc: Document; innerDom: JSDOM } {
	const iframe = parent.window.document.querySelector("iframe");
	assert(iframe, "iframe must be present");
	const innerDom = new JSDOM(innerHtml);
	const innerDoc = innerDom.window.document;
	Object.defineProperty(iframe, "contentDocument", {
		value: innerDoc,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(innerDoc, "readyState", { value: readyState, configurable: true });
	return { iframe, innerDoc, innerDom };
}

describe("initHighlights", () => {
	it("no-ops when the reader has no highlights panel", () => {
		const harness = makeInitHarness("", IFRAME);
		harness.deps.getSelection = () => {
			throw new Error("getSelection must not run without a panel");
		};
		const controller = initHighlights(harness.deps);
		// No panel → inert controller: scanning and stopping are safe no-ops and the
		// injected getSelection (which throws) is never reached.
		controller.scan();
		controller.stop();
	});

	it("throws when the panel has no create form", () => {
		const harness = makeInitHarness(`<div data-highlights-panel data-highlights-count="0"></div>`, IFRAME);
		expect(() => initHighlights(harness.deps)).toThrow(/create form/);
	});

	it("applies the panel's highlights to the iframe on load and does not re-apply on a redundant scan", () => {
		const harness = makeInitHarness(PANEL_WITH_HIGHLIGHT, IFRAME);
		const { innerDoc } = attachInner(harness.parent, ARTICLE);

		const controller = initHighlights(harness.deps);
		const marks = innerDoc.querySelectorAll("mark.rp-highlight");
		expect(marks.length).toBe(1);
		expect(marks[0].textContent).toBe("Hello");

		controller.scan();
		expect(innerDoc.querySelectorAll("mark.rp-highlight").length).toBe(1);
		controller.stop();
	});

	it("starts with a hidden button and shows it for a fresh selection, submitting the create form", () => {
		const harness = makeInitHarness(EMPTY_PANEL, IFRAME);
		const { innerDoc, innerDom } = attachInner(harness.parent, ARTICLE);
		const controller = initHighlights(harness.deps);

		expect(harness.button().hidden).toBe(true);

		const text = childOf(childOf(innerDoc.body));
		harness.setSelection({ rangeCount: 1, getRangeAt: () => rangeOver(innerDoc, text, 6, 11) });
		innerDoc.dispatchEvent(new innerDom.window.Event("mouseup"));

		expect(harness.button().hidden).toBe(false);

		harness.button().click();
		expect(harness.submittedForms.length).toBe(1);
		const form = harness.submittedForms[0];
		expect(form.getAttribute("action")).toBe("/queue/abc/highlights");
		expect(form.querySelector<HTMLInputElement>('input[name="quote"]')?.value).toBe("world");
		expect(form.querySelector<HTMLInputElement>('input[name="start"]')?.value).toBe("6");
		expect(form.querySelector<HTMLInputElement>('input[name="end"]')?.value).toBe("11");

		// A second valid selection reuses the same button element.
		harness.setSelection({ rangeCount: 1, getRangeAt: () => rangeOver(innerDoc, text, 0, 5) });
		innerDoc.dispatchEvent(new innerDom.window.Event("mouseup"));
		expect(harness.parent.window.document.querySelectorAll(".rp-highlight-button").length).toBe(1);
		expect(harness.button().hidden).toBe(false);
		controller.stop();
	});

	it("hides the button when a later selection is empty", () => {
		const harness = makeInitHarness(EMPTY_PANEL, IFRAME);
		const { innerDoc, innerDom } = attachInner(harness.parent, ARTICLE);
		const controller = initHighlights(harness.deps);
		const text = childOf(childOf(innerDoc.body));

		harness.setSelection({ rangeCount: 1, getRangeAt: () => rangeOver(innerDoc, text, 6, 11) });
		innerDoc.dispatchEvent(new innerDom.window.Event("mouseup"));
		expect(harness.button().hidden).toBe(false);

		harness.setSelection(null);
		innerDoc.dispatchEvent(new innerDom.window.Event("mouseup"));
		expect(harness.button().hidden).toBe(true);
		controller.stop();
	});

	it("keeps the button hidden for a collapsed selection and an empty range count", () => {
		const harness = makeInitHarness(EMPTY_PANEL, IFRAME);
		const { innerDoc, innerDom } = attachInner(harness.parent, ARTICLE);
		const controller = initHighlights(harness.deps);
		const text = childOf(childOf(innerDoc.body));

		harness.setSelection({ rangeCount: 0, getRangeAt: () => rangeOver(innerDoc, text, 6, 11) });
		innerDoc.dispatchEvent(new innerDom.window.Event("mouseup"));
		expect(harness.button().hidden).toBe(true);

		harness.setSelection({ rangeCount: 1, getRangeAt: () => rangeOver(innerDoc, text, 4, 4) });
		innerDoc.dispatchEvent(new innerDom.window.Event("mouseup"));
		expect(harness.button().hidden).toBe(true);
		controller.stop();
	});

	it("waits for the iframe load event when the inner document is not yet complete", () => {
		const harness = makeInitHarness(PANEL_WITH_HIGHLIGHT, IFRAME);
		const { iframe, innerDoc } = attachInner(harness.parent, ARTICLE, "loading");
		initHighlights(harness.deps);
		expect(innerDoc.querySelectorAll("mark.rp-highlight").length).toBe(0);

		Object.defineProperty(innerDoc, "readyState", { value: "complete", configurable: true });
		iframe.dispatchEvent(new harness.parent.window.Event("load"));
		expect(innerDoc.querySelectorAll("mark.rp-highlight").length).toBe(1);
	});

	it("does nothing when the iframe has no contentDocument", () => {
		const harness = makeInitHarness(PANEL_WITH_HIGHLIGHT, IFRAME);
		const iframe = harness.parent.window.document.querySelector("iframe");
		assert(iframe, "iframe");
		Object.defineProperty(iframe, "contentDocument", { value: null, configurable: true });
		const controller = initHighlights(harness.deps);
		expect(harness.button().hidden).toBe(true);
		controller.stop();
	});

	it("re-binds and re-applies highlights when an htmx swap replaces the iframe", () => {
		const harness = makeInitHarness(PANEL_WITH_HIGHLIGHT, IFRAME);
		attachInner(harness.parent, ARTICLE);
		initHighlights(harness.deps);

		const parentDoc = harness.parent.window.document;
		const oldIframe = parentDoc.querySelector("iframe");
		assert(oldIframe?.parentNode, "old iframe must have a parent");
		const replacement = parentDoc.createElement("iframe");
		replacement.setAttribute("data-reader-iframe", "");
		oldIframe.parentNode.replaceChild(replacement, oldIframe);
		const innerDomB = new JSDOM(ARTICLE);
		Object.defineProperty(replacement, "contentDocument", {
			value: innerDomB.window.document,
			configurable: true,
		});
		Object.defineProperty(innerDomB.window.document, "readyState", {
			value: "complete",
			configurable: true,
		});

		harness.fireSwap();
		expect(innerDomB.window.document.querySelectorAll("mark.rp-highlight").length).toBe(1);
	});

	it("unbinds when the iframe is removed before a swap", () => {
		const harness = makeInitHarness(EMPTY_PANEL, IFRAME);
		const { iframe, innerDoc, innerDom } = attachInner(harness.parent, ARTICLE);
		initHighlights(harness.deps);

		assert(iframe.parentNode, "iframe parent");
		iframe.parentNode.removeChild(iframe);
		harness.fireSwap();

		const text = childOf(childOf(innerDoc.body));
		harness.setSelection({ rangeCount: 1, getRangeAt: () => rangeOver(innerDoc, text, 6, 11) });
		innerDoc.dispatchEvent(new innerDom.window.Event("mouseup"));
		expect(harness.button().hidden).toBe(true);
	});

	it("stops scanning after stop is called", () => {
		const harness = makeInitHarness(EMPTY_PANEL, IFRAME);
		const { innerDoc, innerDom } = attachInner(harness.parent, ARTICLE);
		const controller = initHighlights(harness.deps);
		controller.stop();
		controller.scan();

		const text = childOf(childOf(innerDoc.body));
		harness.setSelection({ rangeCount: 1, getRangeAt: () => rangeOver(innerDoc, text, 6, 11) });
		innerDoc.dispatchEvent(new innerDom.window.Event("mouseup"));
		expect(harness.button().hidden).toBe(true);
	});
});
