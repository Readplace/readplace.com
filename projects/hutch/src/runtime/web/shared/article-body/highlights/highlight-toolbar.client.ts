import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";

export const HIGHLIGHT_SELECTION_EVENT = "readplace-highlight-selection";

export const SELECTION_DEBOUNCE_MS = 100;
export const POINTER_SETTLE_MS = 10;
export const VIEWPORT_GUTTER_PX = 16;
export const TOOLBAR_GAP_PX = 10;

const CONTENT_SELECTOR = ".article-body__content";
const TOOLBAR_SELECTOR = "[data-highlight-toolbar]";
const BUTTON_SELECTOR = "[data-highlight-toolbar-button]";
const FORM_SELECTOR = "[data-highlight-create-form]";

export interface ToolbarRect {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly width: number;
}

interface ToolbarViewport {
	readonly width: number;
	readonly offsetLeft: number;
	readonly offsetTop: number;
	addEventListener(type: "scroll" | "resize", listener: () => void): void;
}

interface HighlightToolbarWindow {
	readonly visualViewport: ToolbarViewport;
	requestAnimationFrame(callback: () => void): unknown;
}

interface HighlightToolbarTimers {
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

interface HighlightToolbarDeps {
	document: Document;
	window: HighlightToolbarWindow;
	timers: HighlightToolbarTimers;
	rectsOf: (range: Range) => readonly ToolbarRect[];
}

interface SelectedPassage {
	exact: string;
	start: number;
	end: number;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function passageOf(input: { range: Range; content: Element }): SelectedPassage | undefined {
	const chunks = collectTextChunks<Node>(input.content);
	const { text, spans } = normaliseText(chunks);
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

function originOf(event: Event): unknown {
	return Reflect.get(Object(Reflect.get(event, "detail")), "origin");
}

export function initHighlightToolbar(deps: HighlightToolbarDeps): void {
	const { document } = deps;
	let shown: Range | undefined;
	let pending: unknown;
	let frameRequested = false;

	const selectionOf = (): Selection => {
		const selection = document.getSelection();
		assert(selection, "a live reader document always has a selection");
		return selection;
	};

	const toolbarOf = (): HTMLElement => {
		const toolbar = document.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
		assert(toolbar, "the highlight script ships with its toolbar");
		return toolbar;
	};

	const place = (range: Range): void => {
		const toolbar = toolbarOf();
		const rects = deps.rectsOf(range);
		assert(rects.length > 0, "a selection holding text has client rects");
		const first = rects[0];
		const last = rects[rects.length - 1];
		const viewport = deps.window.visualViewport;
		const size = toolbar.getBoundingClientRect();
		const above = first.top - size.height - TOOLBAR_GAP_PX;
		const top = above < viewport.offsetTop ? last.bottom + TOOLBAR_GAP_PX : above;
		const centred = first.left + first.width / 2 - viewport.offsetLeft - size.width / 2;
		const maxLeft = viewport.width - size.width - VIEWPORT_GUTTER_PX;
		const left = Math.min(Math.max(centred, VIEWPORT_GUTTER_PX), maxLeft) + viewport.offsetLeft;
		toolbar.style.top = `${top}px`;
		toolbar.style.left = `${left}px`;
	};

	const hide = (): void => {
		shown = undefined;
		toolbarOf().hidden = true;
	};

	const show = (range: Range): void => {
		shown = range;
		toolbarOf().hidden = false;
		place(range);
	};

	const check = (): void => {
		const selection = selectionOf();
		if (selection.anchorNode === null) return;
		const content = document.querySelector(CONTENT_SELECTOR);
		if (selection.isCollapsed || content === null) {
			hide();
			return;
		}
		const range = selection.getRangeAt(0).cloneRange();
		if (passageOf({ range, content }) === undefined) hide();
		else show(range);
	};

	const scheduleCheck = (delayMs: number): void => {
		deps.timers.clearTimeout(pending);
		pending = deps.timers.setTimeout(check, delayMs);
	};

	const submit = (input: { range: Range; origin: string }): void => {
		const content = document.querySelector(CONTENT_SELECTOR);
		const form = document.querySelector<HTMLFormElement>(FORM_SELECTOR);
		if (content === null || form === null) return;
		const passage = passageOf({ range: input.range, content });
		if (passage === undefined) return;
		const values: Record<string, string> = {
			exact: passage.exact,
			start: String(passage.start),
			end: String(passage.end),
			origin: input.origin,
		};
		for (const [name, value] of Object.entries(values)) {
			const field = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
			assert(field, `the create form carries its ${name} field`);
			field.value = value;
		}
		form.requestSubmit();
		selectionOf().removeAllRanges();
		hide();
	};

	const reposition = (): void => {
		if (frameRequested) return;
		frameRequested = true;
		deps.window.requestAnimationFrame(() => {
			frameRequested = false;
			if (shown !== undefined) place(shown);
		});
	};

	hide();
	document.addEventListener("selectionchange", () => scheduleCheck(SELECTION_DEBOUNCE_MS));
	document.addEventListener("pointerup", () => scheduleCheck(POINTER_SETTLE_MS));
	document.addEventListener("contextmenu", () => scheduleCheck(POINTER_SETTLE_MS));
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") hide();
	});
	document.addEventListener("pointerdown", (event) => {
		if (!event.composedPath().includes(toolbarOf())) hide();
	});
	document.addEventListener("htmx:afterSettle", hide);
	document.addEventListener("click", (event) => {
		const path = event.composedPath();
		const button = document.querySelector(BUTTON_SELECTOR);
		assert(button, "the highlight toolbar carries its button");
		if (path.includes(button)) {
			if (shown !== undefined) submit({ range: shown, origin: "mouse" });
			return;
		}
		const mark = Array.from(document.querySelectorAll(`.${ARTICLE_HIGHLIGHT_CLASS}`))
			.filter((candidate) => path.includes(candidate))
			.at(-1);
		if (mark === undefined) return;
		const row = document.querySelector(`[data-highlight-row="${mark.getAttribute("data-highlight-id")}"]`);
		row?.scrollIntoView({ block: "nearest" });
	});
	document.addEventListener(HIGHLIGHT_SELECTION_EVENT, (event) => {
		const origin = originOf(event);
		const selection = selectionOf();
		if (typeof origin !== "string" || selection.rangeCount === 0) return;
		submit({ range: selection.getRangeAt(0).cloneRange(), origin });
	});
	deps.window.visualViewport.addEventListener("scroll", reposition);
	deps.window.visualViewport.addEventListener("resize", reposition);
}
