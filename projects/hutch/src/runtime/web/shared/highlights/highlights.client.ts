/**
 * Client controller for reader highlights & notes.
 *
 * The article body lives inside a same-origin sandboxed `<iframe srcdoc>` with
 * no `allow-scripts`, so no code runs *inside* the iframe. This controller runs
 * in the parent document and reaches into `iframe.contentDocument` (reachable
 * because the sandbox keeps `allow-same-origin`) to read the user's text
 * selection and to paint `<mark>` elements over previously-saved highlights.
 *
 * Re-anchoring is intentionally simple for the proof-of-concept: a highlight is
 * re-painted by finding the first text node that contains its exact quote. A
 * selection that spans multiple elements is stored and listed, but only painted
 * when its text lands inside a single text node.
 *
 * Browser-specific glue (reading the live Selection, issuing the fetch) is
 * injected so the interaction logic here stays unit-testable; the wiring lives
 * in the esbuild footer in build-client-bundles.js.
 */

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

const SHOW_TEXT = 4;

interface HighlightsDeps {
	document: Document;
	/** Reads the trimmed text the user has selected inside the reader iframe. */
	getSelectionText: () => string;
	/** Persists a highlight; resolves with the re-rendered list HTML, or `null` on failure. */
	postHighlight: (input: { quote: string; note: string }) => Promise<string | null>;
	/** Asks the user for an optional note. Returns `null` when the user cancels. */
	promptNote: () => string | null;
	addSwapListener: (listener: () => void) => void;
}

interface HighlightsController {
	handleSelection: () => void;
	addHighlight: () => Promise<void>;
	reapply: () => void;
	stop: () => void;
}

const IFRAME_SELECTOR = "iframe[data-reader-iframe]";

function unwrapExistingMarks(doc: Document): void {
	for (const mark of Array.from(doc.querySelectorAll("mark.rp-highlight"))) {
		mark.replaceWith(doc.createTextNode(mark.textContent ?? ""));
	}
	doc.body.normalize();
}

function paintQuote(doc: Document, quote: string, id: string): boolean {
	const walker = doc.createTreeWalker(doc.body, SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const value = node.nodeValue ?? "";
		const index = value.indexOf(quote);
		if (index !== -1) {
			const middle = (node as Text).splitText(index);
			middle.splitText(quote.length);
			const mark = doc.createElement("mark");
			mark.className = "rp-highlight";
			mark.setAttribute("data-highlight-id", id);
			mark.textContent = middle.nodeValue;
			middle.replaceWith(mark);
			return true;
		}
		node = walker.nextNode();
	}
	return false;
}

export function initHighlights(deps: HighlightsDeps): HighlightsController {
	const panel = deps.document.querySelector("[data-highlights]");
	const list = deps.document.querySelector("[data-highlights-list]");
	const addButton = deps.document.querySelector<HTMLElement>("[data-highlights-add]");

	const noop: HighlightsController = {
		handleSelection() {},
		async addHighlight() {},
		reapply() {},
		stop() {},
	};
	if (!panel || !list || !addButton) return noop;
	const listEl = list;
	const button = addButton;

	let pendingQuote = "";
	let stopped = false;

	function findIframe(): HTMLIFrameElement | null {
		return deps.document.querySelector<HTMLIFrameElement>(IFRAME_SELECTOR);
	}

	function reapply(): void {
		if (stopped) return;
		const iframe = findIframe();
		if (!iframe) return;
		const doc = iframe.contentDocument;
		assert(doc, "reader iframe must be same-origin so contentDocument is reachable");
		unwrapExistingMarks(doc);
		for (const item of Array.from(listEl.querySelectorAll<HTMLElement>("[data-highlight-id]"))) {
			const quote = item.getAttribute("data-highlight-quote");
			const id = item.getAttribute("data-highlight-id");
			if (quote && id) paintQuote(doc, quote, id);
		}
	}

	function handleSelection(): void {
		const text = deps.getSelectionText().trim();
		pendingQuote = text;
		button.hidden = text.length === 0;
	}

	async function addHighlight(): Promise<void> {
		if (pendingQuote.length === 0) return;
		const note = deps.promptNote();
		if (note === null) return;
		const html = await deps.postHighlight({ quote: pendingQuote, note });
		if (html === null) return;
		listEl.innerHTML = html;
		pendingQuote = "";
		button.hidden = true;
		reapply();
	}

	const onMouseUp = () => handleSelection();
	const onClick = () => {
		void addHighlight();
	};

	const boundIframes = new Set<HTMLIFrameElement>();

	function bindSelection(target: HTMLIFrameElement): void {
		const doc = target.contentDocument;
		assert(doc, "reader iframe must be same-origin to observe selection");
		doc.addEventListener("mouseup", onMouseUp);
	}

	/** The reader streams its body in via HTMX polls: a still-crawling article
	 * first renders a pending fragment with *no* iframe, and the iframe is
	 * swapped in only once the crawl finishes — after this deferred script has
	 * already run. Selection must therefore be (re-)bound every time we first
	 * see an iframe element, not once at init; otherwise the "Add highlight"
	 * button never appears on the common save-then-watch-it-load path. The
	 * `Set` keeps the bind idempotent across the repeated `htmx:afterSwap`
	 * events, mirroring reader-iframe.client.ts. The srcdoc document may still
	 * be the initial about:blank when the element first appears, so also bind
	 * (and re-paint) on its `load`. */
	function bindIframe(target: HTMLIFrameElement): void {
		if (boundIframes.has(target)) return;
		boundIframes.add(target);
		target.addEventListener("load", () => {
			bindSelection(target);
			reapply();
		});
		if (target.contentDocument?.readyState === "complete") {
			bindSelection(target);
		}
	}

	function scan(): void {
		if (stopped) return;
		const iframe = findIframe();
		if (iframe) bindIframe(iframe);
		reapply();
	}

	button.addEventListener("click", onClick);
	deps.addSwapListener(scan);
	scan();

	return {
		handleSelection,
		addHighlight,
		reapply,
		stop() {
			stopped = true;
			button.removeEventListener("click", onClick);
		},
	};
}
