import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";

export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export const STALLED_SAVE_MS = 3000;

const CONTENT_SELECTOR = ".article-body__content";
const STATUS_SELECTOR = "[data-highlight-status]";
const MESSAGE_SELECTOR = "[data-highlight-status-message]";
const QUOTE_SELECTOR = "[data-highlight-status-quote]";
const DISMISS_SELECTOR = "[data-highlight-status-dismiss]";
const READER_ATTRIBUTE = "data-highlight-reader";
const CHECK_URL_ATTRIBUTE = "data-highlight-check-url";
const REFUSAL_ATTRIBUTE = "data-highlight-refusal";
const SHOWN_ATTRIBUTE = "data-highlight-status-shown";
const PENDING_ATTRIBUTE = "data-highlight-pending";
const RECOVERABLE_REFUSAL = "cancelled";

type StatusAction = "stop" | "check" | "retry";
type StatusCopy =
	| "saving" | "stalled" | "unsure" | "checking" | "highlighted" | "absent" | "unconfirmed";

export interface Passage {
	exact: string;
	start: number;
	end: number;
}

interface Boundary {
	node: Node;
	offset: number;
}

interface ReaderSelection {
	passage: Passage;
	backward: boolean;
	reader: string;
}

interface Operation {
	form: HTMLFormElement;
	passage: Passage;
	reader: string;
	xhr: unknown;
	held: (() => void) | undefined;
	restore: ReaderSelection | undefined;
	stalled: unknown;
}

interface Recovery {
	passage: Passage;
	reader: string;
}

export interface ReaderFetch {
	ok: boolean;
	html: string;
}

export interface PendingHighlightDeps {
	document: Document;
	timers: {
		setTimeout(callback: () => void, delayMs: number): unknown;
		clearTimeout(handle: unknown): void;
	};
	selectionOf: () => Selection;
	paintPending: (range: Range) => boolean;
	clearPending: () => void;
	fetchReader: (url: string) => Promise<ReaderFetch>;
	parseHtml: (html: string) => Document;
	resubmit: (range: Range) => void;
}

export interface PendingHighlights {
	inFlight(): boolean;
	begin(input: { form: HTMLFormElement; range: Range; passage: Passage }): void;
}

function detailOf(event: Event, key: string): unknown {
	return Reflect.get(Object(Reflect.get(event, "detail")), key);
}

function textOf(content: Element) {
	const chunks = collectTextChunks<Node>(content);
	return { chunks, ...normaliseText(chunks) };
}

export function passageOf(input: { range: Range; content: Element }): Passage | undefined {
	const { chunks, text, spans } = textOf(input.content);
	const touched = chunks.map((chunk) => input.range.intersectsNode(chunk.node));
	let start = -1;
	let end = -1;
	spans.forEach((span, index) => {
		if (span.start === span.end || !touched[span.chunk]) return;
		const node = chunks[span.chunk].node;
		if (!input.range.isPointInRange(node, span.start) || !input.range.isPointInRange(node, span.end)) return;
		if (start < 0) start = index;
		end = index + 1;
	});
	return start < 0 ? undefined : { exact: text.slice(start, end), start, end };
}

export function boundariesOf(input: { content: Element; passage: Passage }): { start: Boundary; end: Boundary } | undefined {
	const { chunks, text, spans } = textOf(input.content);
	if (text.slice(input.passage.start, input.passage.end) !== input.passage.exact) return undefined;
	const first = spans[input.passage.start];
	const last = spans[input.passage.end - 1];
	return {
		start: { node: chunks[first.chunk].node, offset: first.start },
		end: { node: chunks[last.chunk].node, offset: last.end },
	};
}

export function coverageOf(input: { content: Element; passage: Passage }): "highlighted" | "absent" | "changed" {
	const { chunks, text, spans } = textOf(input.content);
	if (text.slice(input.passage.start, input.passage.end) !== input.passage.exact) return "changed";
	for (let index = input.passage.start; index < input.passage.end; index += 1) {
		if (/\s/.test(text[index])) continue;
		const node = chunks[spans[index].chunk].node;
		if (node.parentElement?.closest(`.${ARTICLE_HIGHLIGHT_CLASS}`) === null) return "absent";
	}
	return "highlighted";
}

export function initPendingHighlights(deps: PendingHighlightDeps): PendingHighlights {
	const { document } = deps;
	let operation: Operation | undefined;
	let recovery: Recovery | undefined;
	let gesture = false;
	let generation = 0;

	const statusRegion = (): HTMLElement | null => document.querySelector<HTMLElement>(STATUS_SELECTOR);

	const setShown = (region: HTMLElement, shown: boolean): void => {
		const dismiss = region.querySelector<HTMLButtonElement>(DISMISS_SELECTOR);
		assert(dismiss, "the highlight status carries its dismiss action");
		dismiss.hidden = !shown;
		region.toggleAttribute(SHOWN_ATTRIBUTE, shown);
	};

	const showStatus = (input: {
		copy: StatusCopy | undefined;
		quote: string | undefined;
		actions: readonly StatusAction[];
	}): void => {
		const region = statusRegion();
		if (region === null) return;
		const message = region.querySelector(MESSAGE_SELECTOR);
		const quote = region.querySelector<HTMLElement>(QUOTE_SELECTOR);
		assert(message, "the highlight status carries its message");
		assert(quote, "the highlight status carries its quote");
		message.textContent = input.copy === undefined ? "" : region.getAttribute(`data-copy-${input.copy}`);
		quote.textContent = input.quote ?? "";
		quote.hidden = input.quote === undefined;
		for (const button of region.querySelectorAll<HTMLButtonElement>("[data-highlight-status-action]")) {
			const action = button.getAttribute("data-highlight-status-action");
			button.hidden = !input.actions.some((wanted) => wanted === action);
		}
		region.removeAttribute(REFUSAL_ATTRIBUTE);
		setShown(region, input.actions.length > 0);
	};

	const settlePaint = (current: Operation): void => {
		deps.timers.clearTimeout(current.stalled);
		current.form.removeAttribute(PENDING_ATTRIBUTE);
		deps.clearPending();
	};

	const discard = (): void => {
		generation += 1;
		recovery = undefined;
		if (operation === undefined) return;
		settlePaint(operation);
		operation = undefined;
	};

	const captureSelection = (reader: string): ReaderSelection | undefined => {
		const selection = deps.selectionOf();
		const content = document.querySelector(CONTENT_SELECTOR);
		if (selection.rangeCount === 0 || selection.isCollapsed || content === null) return undefined;
		const range = selection.getRangeAt(0);
		const passage = passageOf({ range, content });
		if (passage === undefined) return undefined;
		const backward = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
		return { passage, backward, reader };
	};

	const restoreSelection = (snapshot: ReaderSelection): void => {
		const content = document.querySelector(CONTENT_SELECTOR);
		if (content === null || statusRegion()?.getAttribute(READER_ATTRIBUTE) !== snapshot.reader) return;
		const boundaries = boundariesOf({ content, passage: snapshot.passage });
		if (boundaries === undefined) return;
		const [anchor, focus] = snapshot.backward
			? [boundaries.end, boundaries.start]
			: [boundaries.start, boundaries.end];
		deps.selectionOf().setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
	};

	const offerRetry = (refused: Recovery): void => {
		const region = statusRegion();
		const content = document.querySelector(CONTENT_SELECTOR);
		if (region === null || content === null) return;
		if (region.getAttribute(REFUSAL_ATTRIBUTE) !== RECOVERABLE_REFUSAL) return;
		if (region.getAttribute(READER_ATTRIBUTE) !== refused.reader) return;
		if (boundariesOf({ content, passage: refused.passage }) === undefined) return;
		recovery = refused;
		const retry = region.querySelector<HTMLButtonElement>('[data-highlight-status-action="retry"]');
		assert(retry, "the highlight status carries its retry action");
		retry.hidden = false;
		setShown(region, true);
	};

	const swapped = (current: Operation): void => {
		settlePaint(current);
		operation = undefined;
		if (current.restore !== undefined) restoreSelection(current.restore);
		offerRetry({ passage: current.passage, reader: current.reader });
	};

	const unsure = (current: Operation): void => {
		settlePaint(current);
		operation = undefined;
		recovery = { passage: current.passage, reader: current.reader };
		showStatus({ copy: "unsure", quote: current.passage.exact, actions: ["check"] });
	};

	const check = async (): Promise<void> => {
		const region = statusRegion();
		if (recovery === undefined || region === null) return;
		const url = region.getAttribute(CHECK_URL_ATTRIBUTE);
		assert(url, "the highlight status names the reader it checks");
		const checking = recovery;
		const asked = generation;
		showStatus({ copy: "checking", quote: checking.passage.exact, actions: [] });
		const outcome = await deps.fetchReader(url).then(
			(response) => (response.ok ? readCoverage({ html: response.html, checking }) : "unconfirmed"),
			() => "unconfirmed" as const,
		);
		if (asked !== generation || recovery !== checking) return;
		showStatus({ copy: outcome, quote: checking.passage.exact, actions: ["check"] });
	};

	const readCoverage = (input: { html: string; checking: Recovery }): "highlighted" | "absent" | "unconfirmed" => {
		const page = deps.parseHtml(input.html);
		const content = page.querySelector(CONTENT_SELECTOR);
		const reader = page.querySelector(STATUS_SELECTOR)?.getAttribute(READER_ATTRIBUTE);
		if (content === null || reader !== input.checking.reader) return "unconfirmed";
		const coverage = coverageOf({ content, passage: input.checking.passage });
		return coverage === "changed" ? "unconfirmed" : coverage;
	};

	const retry = (): void => {
		const content = document.querySelector(CONTENT_SELECTOR);
		if (recovery === undefined || content === null) return;
		const boundaries = boundariesOf({ content, passage: recovery.passage });
		if (boundaries === undefined) return;
		const range = document.createRange();
		range.setStart(boundaries.start.node, boundaries.start.offset);
		range.setEnd(boundaries.end.node, boundaries.end.offset);
		recovery = undefined;
		deps.resubmit(range);
	};

	const stopWaiting = (): void => {
		if (operation === undefined) return;
		if (operation.held !== undefined) {
			const release = operation.held;
			operation.held = undefined;
			release();
			return;
		}
		const view = document.defaultView;
		assert(view, "a live reader document has a window");
		operation.form.dispatchEvent(new view.CustomEvent("htmx:abort", { bubbles: true, detail: {} }));
	};

	const dismiss = (): void => {
		recovery = undefined;
		showStatus({ copy: undefined, quote: undefined, actions: [] });
	};

	const matches = (event: Event): Operation | undefined => {
		const xhr = detailOf(event, "xhr");
		return operation !== undefined && xhr !== undefined && operation.xhr === xhr ? operation : undefined;
	};

	document.addEventListener("htmx:beforeRequest", (event) => {
		if (operation === undefined || operation.xhr !== undefined) return;
		if (detailOf(event, "elt") !== operation.form) return;
		operation.xhr = detailOf(event, "xhr");
	});

	document.addEventListener("htmx:beforeSend", (event) => {
		const current = matches(event);
		if (current === undefined) return;
		const xhr = Object(current.xhr);
		const load: unknown = Reflect.get(xhr, "onload");
		assert(typeof load === "function", "htmx assigns the request's load handler before it sends");
		Reflect.set(xhr, "onload", (...args: unknown[]) => {
			const run = () => Reflect.apply(load, xhr, args);
			if (gesture && operation === current) current.held = run;
			else run();
		});
	});

	document.addEventListener("htmx:beforeSwap", (event) => {
		const current = matches(event);
		if (current !== undefined) {
			current.restore = captureSelection(current.reader);
			return;
		}
		const target = detailOf(event, "target");
		const owned = operation === undefined ? statusRegion() : operation.form;
		for (let node: Node | null = owned; node !== null; node = node.parentNode) {
			if (node !== target) continue;
			discard();
			return;
		}
	});

	document.addEventListener("htmx:afterSwap", (event) => {
		const current = matches(event);
		if (current !== undefined) swapped(current);
	});

	document.addEventListener("htmx:afterRequest", (event) => {
		const current = matches(event);
		if (current !== undefined) unsure(current);
	});

	document.addEventListener("htmx:historyRestore", discard);

	document.addEventListener("pointerdown", (event) => {
		const content = document.querySelector(CONTENT_SELECTOR);
		gesture = content !== null && event.composedPath().includes(content);
	});

	const endGesture = (): void => {
		gesture = false;
		if (operation?.held === undefined) return;
		const release = operation.held;
		operation.held = undefined;
		release();
	};
	document.addEventListener("pointerup", endGesture);
	document.addEventListener("pointercancel", endGesture);

	document.addEventListener("click", (event) => {
		const region = statusRegion();
		if (region === null) return;
		const dismissButton = region.querySelector(DISMISS_SELECTOR);
		assert(dismissButton, "the highlight status carries its dismiss action");
		if (event.composedPath().includes(dismissButton)) {
			dismiss();
			return;
		}
		const button = Array.from(region.querySelectorAll("[data-highlight-status-action]")).find((candidate) =>
			event.composedPath().includes(candidate),
		);
		const action = button?.getAttribute("data-highlight-status-action");
		if (action === "stop") stopWaiting();
		else if (action === "check") void check();
		else if (action === "retry") retry();
	});

	return {
		inFlight: () => operation !== undefined,
		begin(input) {
			const region = statusRegion();
			const reader = region?.getAttribute(READER_ATTRIBUTE) ?? "";
			recovery = undefined;
			const current: Operation = {
				form: input.form,
				passage: input.passage,
				reader,
				xhr: undefined,
				held: undefined,
				restore: undefined,
				stalled: undefined,
			};
			operation = current;
			if (deps.paintPending(input.range)) input.form.setAttribute(PENDING_ATTRIBUTE, "");
			showStatus({ copy: "saving", quote: undefined, actions: [] });
			current.stalled = deps.timers.setTimeout(() => {
				if (operation === current) showStatus({ copy: "stalled", quote: undefined, actions: ["stop"] });
			}, STALLED_SAVE_MS);
		},
	};
}
