/**
 * Client-side highlighting for the authenticated reader.
 *
 * The article body is rendered inside a sandboxed `<iframe srcdoc>` that allows
 * same-origin access (see reader-iframe.client.ts), so this parent-document
 * script can both read text selections inside the iframe and inject `<mark>`
 * wrappers back into it. Highlights are anchored by a character range over the
 * iframe body's text content; the side-menu (rendered server-side as
 * `[data-highlights-panel]`) is the source of truth for which ranges to
 * re-apply on load.
 *
 * Creating a highlight reuses the server-rendered `[data-highlights-create-form]`
 * in the panel: the floating "Highlight" button fills that form's fields from the
 * live selection and submits it, so the round-trip uses the same SSR pipeline as
 * the note-edit and delete forms — and the form's action and field names live in
 * the template, not hardcoded here.
 */

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const READER_IFRAME_SELECTOR = "iframe[data-reader-iframe]";
const PANEL_SELECTOR = "[data-highlights-panel]";
const CREATE_FORM_SELECTOR = "[data-highlights-create-form]";
const ITEM_SELECTOR = "[data-highlights-item]";
const HIGHLIGHT_CLASS = "rp-highlight";
const BUTTON_CLASS = "rp-highlight-button";
const TEXT_NODE = 3; // Node.TEXT_NODE — referenced as a literal so the bundle needs no DOM globals.

export interface HighlightAnchorInput {
	start: number;
	end: number;
	quote: string;
}

export interface HighlightEntry {
	id: string;
	start: number;
	end: number;
	quote: string;
}

export interface TextSegment {
	node: Text;
	from: number;
	to: number;
}

/** The subset of `Selection` this module reads. `Document.getSelection()`
 * satisfies it structurally, and tests can supply a plain stub without a cast. */
export interface SelectionLike {
	rangeCount: number;
	getRangeAt(index: number): Range;
}

export interface HighlightsClientDeps {
	document: Document;
	getSelection: (doc: Document) => SelectionLike | null;
	submitForm: (form: HTMLFormElement) => void;
	addSwapListener: (listener: () => void) => void;
}

function isText(node: Node): node is Text {
	return node.nodeType === TEXT_NODE;
}

function collectTextNodes(node: Node): Text[] {
	const result: Text[] = [];
	for (const child of Array.from(node.childNodes)) {
		if (isText(child)) result.push(child);
		else result.push(...collectTextNodes(child));
	}
	return result;
}

/**
 * Maps the character range `[start, end)` over `root`'s text content to the
 * per-text-node segments it covers. Offsets are measured the same way
 * `anchorFromRange` produces them, so a saved anchor round-trips back to the
 * exact text nodes.
 */
export function textSegmentsInRange(
	root: Node,
	start: number,
	end: number,
): TextSegment[] {
	const segments: TextSegment[] = [];
	let running = 0;
	for (const node of collectTextNodes(root)) {
		const nodeStart = running;
		const nodeEnd = running + node.data.length;
		const from = Math.max(start, nodeStart);
		const to = Math.min(end, nodeEnd);
		if (from < to) segments.push({ node, from: from - nodeStart, to: to - nodeStart });
		running = nodeEnd;
	}
	return segments;
}

function wrapSegment(doc: Document, segment: TextSegment, id: string): void {
	const text = segment.node.data;
	const before = text.slice(0, segment.from);
	const middle = text.slice(segment.from, segment.to);
	const after = text.slice(segment.to);

	const mark = doc.createElement("mark");
	mark.className = HIGHLIGHT_CLASS;
	mark.setAttribute("data-rp-highlight-id", id);
	mark.textContent = middle;

	const fragment = doc.createDocumentFragment();
	if (before !== "") fragment.appendChild(doc.createTextNode(before));
	fragment.appendChild(mark);
	if (after !== "") fragment.appendChild(doc.createTextNode(after));
	segment.node.replaceWith(fragment);
}

/**
 * Wraps the highlight's character range in `<mark>` elements inside `root`.
 * The range's current text is compared against the stored `quote`: if they
 * differ — e.g. the article was re-crawled and the offsets now point at
 * different text — the highlight is skipped rather than marking the wrong words.
 */
export function wrapHighlight(doc: Document, root: Node, entry: HighlightEntry): void {
	// Capture every covered text node before mutating: each segment is a distinct
	// node, so replacing one never invalidates the others' references.
	const segments = textSegmentsInRange(root, entry.start, entry.end);
	const anchoredText = segments.map((s) => s.node.data.slice(s.from, s.to)).join("");
	if (anchoredText !== entry.quote) return;
	for (const segment of segments) wrapSegment(doc, segment, entry.id);
}

function applyHighlights(doc: Document, root: Node, entries: readonly HighlightEntry[]): void {
	for (const entry of entries) wrapHighlight(doc, root, entry);
}

/**
 * Derives the persisted anchor from a live selection range: a character offset
 * into `root`'s text content plus the selected text. Returns `undefined` for an
 * empty/whitespace selection or one that escapes the article body.
 */
export function anchorFromRange(root: Element, range: Range): HighlightAnchorInput | undefined {
	if (range.collapsed) return undefined;
	if (!root.contains(range.commonAncestorContainer)) return undefined;
	const quote = range.toString();
	if (quote.trim() === "") return undefined;
	const prefix = range.cloneRange();
	prefix.selectNodeContents(root);
	prefix.setEnd(range.startContainer, range.startOffset);
	const start = prefix.toString().length;
	return { start, end: start + quote.length, quote };
}

export function selectionButtonPosition(input: {
	selectionRect: { left: number; bottom: number };
	iframeRect: { left: number; top: number };
	scrollX: number;
	scrollY: number;
}): { left: number; top: number } {
	return {
		left: input.scrollX + input.iframeRect.left + input.selectionRect.left,
		top: input.scrollY + input.iframeRect.top + input.selectionRect.bottom + 6,
	};
}

export function readPanelEntries(panel: Element): HighlightEntry[] {
	const entries: HighlightEntry[] = [];
	for (const item of Array.from(panel.querySelectorAll(ITEM_SELECTOR))) {
		const id = item.getAttribute("data-rp-highlight-id");
		const startAttr = item.getAttribute("data-rp-start");
		const endAttr = item.getAttribute("data-rp-end");
		const quote = item.getAttribute("data-rp-quote");
		if (id === null || startAttr === null || endAttr === null || quote === null) continue;
		const start = Number(startAttr);
		const end = Number(endAttr);
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		entries.push({ id, start, end, quote });
	}
	return entries;
}

function setFormValue(form: HTMLFormElement, name: string, value: string): void {
	const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
	assert(input, `highlights create form is missing its ${name} field`);
	input.value = value;
}

export function initHighlights(deps: HighlightsClientDeps): {
	scan: () => void;
	stop: () => void;
} {
	const panel = deps.document.querySelector(PANEL_SELECTOR);
	if (panel === null) return { scan() {}, stop() {} };

	const createFormEl = panel.querySelector<HTMLFormElement>(CREATE_FORM_SELECTOR);
	assert(createFormEl, "highlights panel must contain a create form");
	const createForm: HTMLFormElement = createFormEl;
	const entries = readPanelEntries(panel);

	const button = deps.document.createElement("button");
	button.type = "button";
	button.className = BUTTON_CLASS;
	button.textContent = "Highlight";
	button.hidden = true;
	deps.document.body.appendChild(button);

	let stopped = false;
	let boundDoc: Document | undefined;
	let binding: { innerDoc: Document; onMouseUp: () => void } | undefined;

	function hideButton(): void {
		button.hidden = true;
	}

	function submitAnchor(anchor: HighlightAnchorInput): void {
		setFormValue(createForm, "start", String(anchor.start));
		setFormValue(createForm, "end", String(anchor.end));
		setFormValue(createForm, "quote", anchor.quote);
		deps.submitForm(createForm);
	}

	function showButton(anchor: HighlightAnchorInput, range: Range, iframe: HTMLIFrameElement): void {
		button.onclick = () => submitAnchor(anchor);
		const selectionRect = range.getBoundingClientRect();
		const iframeRect = iframe.getBoundingClientRect();
		const position = selectionButtonPosition({
			selectionRect: { left: selectionRect.left, bottom: selectionRect.bottom },
			iframeRect: { left: iframeRect.left, top: iframeRect.top },
			scrollX: deps.document.documentElement.scrollLeft,
			scrollY: deps.document.documentElement.scrollTop,
		});
		button.style.left = `${position.left}px`;
		button.style.top = `${position.top}px`;
		button.hidden = false;
	}

	function onSelection(innerDoc: Document, root: Element, iframe: HTMLIFrameElement): void {
		const selection = deps.getSelection(innerDoc);
		if (!selection || selection.rangeCount === 0) {
			hideButton();
			return;
		}
		const range = selection.getRangeAt(0);
		const anchor = anchorFromRange(root, range);
		if (!anchor) {
			hideButton();
			return;
		}
		showButton(anchor, range, iframe);
	}

	function unbind(): void {
		if (binding) {
			binding.innerDoc.removeEventListener("mouseup", binding.onMouseUp);
			binding = undefined;
		}
		hideButton();
		boundDoc = undefined;
	}

	function bind(iframe: HTMLIFrameElement, innerDoc: Document): void {
		const root = innerDoc.body;
		applyHighlights(innerDoc, root, entries);
		const onMouseUp = () => onSelection(innerDoc, root, iframe);
		innerDoc.addEventListener("mouseup", onMouseUp);
		binding = { innerDoc, onMouseUp };
		boundDoc = innerDoc;
	}

	function scan(): void {
		if (stopped) return;
		const iframe = deps.document.querySelector<HTMLIFrameElement>(READER_IFRAME_SELECTOR);
		if (!iframe) {
			unbind();
			return;
		}
		const innerDoc = iframe.contentDocument;
		if (!innerDoc) {
			unbind();
			return;
		}
		if (innerDoc.readyState !== "complete") {
			iframe.addEventListener("load", scan, { once: true });
			return;
		}
		if (boundDoc === innerDoc) return;
		unbind();
		bind(iframe, innerDoc);
	}

	deps.addSwapListener(scan);
	scan();

	return {
		scan,
		stop(): void {
			stopped = true;
			unbind();
		},
	};
}
