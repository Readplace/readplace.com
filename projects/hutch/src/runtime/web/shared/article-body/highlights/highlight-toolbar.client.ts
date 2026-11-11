import { collectTextChunks, normaliseText } from "@packages/domain/article/highlight";
import type { HighlightCreatedEvent, HighlightOpenedEvent } from "@packages/web-analytics";
import { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";
import { COARSE_POINTER_QUERY, initSentenceTap, type SentenceTapWindow } from "./sentence-tap.client";
import { placeBelowSelection, TOOLBAR_GAP_PX, VIEWPORT_GUTTER_PX } from "./toolbar-placement-coarse";

export const HIGHLIGHT_SELECTION_EVENT = "readplace-highlight-selection";

export const SELECTION_DEBOUNCE_MS = 100;
export const POINTER_SETTLE_MS = 10;

const CONTENT_SELECTOR = ".article-body__content";
const TOOLBAR_SELECTOR = "[data-highlight-toolbar]";
const BUTTON_SELECTOR = "[data-highlight-toolbar-button]";
const FORM_SELECTOR = "[data-highlight-create-form]";
const NOTE_INPUT_SELECTOR = "textarea";
const NOTE_ERROR_SELECTOR = "[data-dialog-form-error]";
const PASSAGE_REFUSAL = "passage";
const JUMP_SELECTOR = "[data-highlight-jump]";
const OPENED_URL_ATTRIBUTE = "data-highlight-opened-url";

export interface ToolbarRect {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly width: number;
}

interface ToolbarViewport {
	readonly width: number;
	readonly height: number;
	readonly offsetLeft: number;
	readonly offsetTop: number;
	addEventListener(type: "scroll" | "resize", listener: () => void): void;
}

interface HighlightToolbarWindow extends SentenceTapWindow {
	readonly visualViewport: ToolbarViewport;
	requestAnimationFrame(callback: () => void): unknown;
	addEventListener(type: "scroll", listener: () => void, options: { passive: boolean }): void;
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
	isPopoverOpen: () => boolean;
	supportsPopover: () => boolean;
	showPopover: (panel: Element) => void;
	sendBeacon: (url: string) => void;
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

function placeAboveSelection(input: {
	rects: readonly ToolbarRect[];
	size: { width: number; height: number };
	viewport: ToolbarViewport;
}): { top: number; left: number } {
	const { rects, size, viewport } = input;
	const first = rects[0];
	const last = rects[rects.length - 1];
	const above = first.top - size.height - TOOLBAR_GAP_PX;
	const top = above < viewport.offsetTop ? last.bottom + TOOLBAR_GAP_PX : above;
	const centred = first.left + first.width / 2 - viewport.offsetLeft - size.width / 2;
	const maxLeft = viewport.width - size.width - VIEWPORT_GUTTER_PX;
	const left = Math.min(Math.max(centred, VIEWPORT_GUTTER_PX), maxLeft) + viewport.offsetLeft;
	return { top, left };
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

	const isCoarse = (): boolean => deps.window.matchMedia(COARSE_POINTER_QUERY).matches;

	const sentenceTap = initSentenceTap({
		document,
		window: deps.window,
		isPopoverOpen: deps.isPopoverOpen,
		selectionOf,
	});

	const pressOrigin = (range: Range): HighlightCreatedEvent["origin"] => {
		if (sentenceTap.isTapped(range)) return "tap";
		return isCoarse() ? "longpress" : "mouse";
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
		const viewport = deps.window.visualViewport;
		const size = toolbar.getBoundingClientRect();
		const { top, left } = isCoarse()
			? placeBelowSelection({
					rects,
					toolbar: { width: size.width, height: size.height },
					viewport: {
						width: viewport.width,
						height: viewport.height,
						offsetLeft: viewport.offsetLeft,
						offsetTop: viewport.offsetTop,
					},
				})
			: placeAboveSelection({ rects, size, viewport });
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

	const fill = (input: { range: Range; origin: string; formSelector: string }): HTMLFormElement | undefined => {
		const content = document.querySelector(CONTENT_SELECTOR);
		const form = document.querySelector<HTMLFormElement>(input.formSelector);
		if (content === null || form === null) return undefined;
		const passage = passageOf({ range: input.range, content });
		if (passage === undefined) return undefined;
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
		return form;
	};

	const submit = (input: { range: Range; origin: string; formSelector: string }): void => {
		const form = fill(input);
		if (form === undefined) return;
		form.requestSubmit();
		selectionOf().removeAllRanges();
		hide();
	};

	const openNoteDialog = (input: { range: Range; origin: string; formSelector: string }): void => {
		if (!deps.supportsPopover()) return;
		const form = fill(input);
		if (form === undefined) return;
		const note = form.querySelector<HTMLTextAreaElement>(NOTE_INPUT_SELECTOR);
		const error = form.querySelector(NOTE_ERROR_SELECTOR);
		const dialog = form.closest("[popover]");
		assert(note, "the note form carries its note field");
		assert(error, "the note form carries its error line");
		assert(dialog, "the note form sits in its dialog");
		if (form.getAttribute("data-highlight-note-refusal") !== PASSAGE_REFUSAL) note.value = "";
		note.removeAttribute("aria-invalid");
		error.textContent = "";
		deps.showPopover(dialog);
		hide();
	};

	const press = (button: Element): void => {
		if (shown === undefined) return;
		const formSelector = button.getAttribute("data-highlight-form");
		assert(formSelector, "each highlight toolbar button names its form");
		const commit = button.getAttribute("data-highlight-commit") === "dialog" ? openNoteDialog : submit;
		commit({ range: shown, origin: pressOrigin(shown), formSelector });
	};

	const opened = (input: { highlightId: string | null; origin: HighlightOpenedEvent["origin"] }): void => {
		const url = toolbarOf().getAttribute(OPENED_URL_ATTRIBUTE);
		assert(url, "the highlight toolbar names its opened beacon");
		assert(input.highlightId, "an opened highlight carries its id");
		deps.sendBeacon(`${url}?${new URLSearchParams({ highlight: input.highlightId, origin: input.origin })}`);
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
	document.addEventListener("htmx:afterSettle", check);
	document.addEventListener("click", (event) => {
		const path = event.composedPath();
		const buttons = Array.from(document.querySelectorAll(BUTTON_SELECTOR));
		assert(buttons.length > 0, "the highlight toolbar carries its button");
		const button = buttons.find((candidate) => path.includes(candidate));
		if (button !== undefined) {
			press(button);
			return;
		}
		const jump = Array.from(document.querySelectorAll(JUMP_SELECTOR)).find((candidate) => path.includes(candidate));
		if (jump !== undefined) {
			opened({ highlightId: jump.getAttribute("data-highlight-jump"), origin: "rail" });
			return;
		}
		const mark = Array.from(document.querySelectorAll(`.${ARTICLE_HIGHLIGHT_CLASS}`))
			.filter((candidate) => path.includes(candidate))
			.at(-1);
		if (mark === undefined) return;
		opened({ highlightId: mark.getAttribute("data-highlight-id"), origin: "mark" });
	});
	document.addEventListener(HIGHLIGHT_SELECTION_EVENT, (event) => {
		const origin = originOf(event);
		const selection = selectionOf();
		if (typeof origin !== "string" || selection.rangeCount === 0) return;
		submit({ range: selection.getRangeAt(0).cloneRange(), origin, formSelector: FORM_SELECTOR });
	});
	deps.window.visualViewport.addEventListener("scroll", reposition);
	deps.window.visualViewport.addEventListener("resize", reposition);
	deps.window.addEventListener("scroll", reposition, { passive: true });
}
