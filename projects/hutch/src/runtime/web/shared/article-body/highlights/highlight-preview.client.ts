import { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";
import { type PassageRect, type PlacementViewport, placeClearOfPassage } from "./place-clear-of-passage";

export const HOVER_SHOW_MS = 400;
export const HOVER_GRACE_MS = 300;

const CONTENT_SELECTOR = ".article-body__content";
const PREVIEW_ATTRIBUTE = "data-highlight-preview";
const PREVIEW_ID_PREFIX = "preview-highlight-";
const PINNED_CLASS = "highlight-preview--pinned";
const HOVER_QUERY = "(hover: hover)";
const INTERACTIVE_SELECTOR = "a[href], button, input, select, textarea, summary, label";
const MARK_SELECTOR = `.${ARTICLE_HIGHLIGHT_CLASS}`;

interface PreviewWindow {
	readonly visualViewport: PlacementViewport;
	matchMedia(query: string): { readonly matches: boolean };
}

interface PreviewTimers {
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface HighlightPreviewDeps {
	document: Document;
	window: PreviewWindow;
	timers: PreviewTimers;
	rectsOf: (range: Range) => readonly PassageRect[];
	selectionOf: () => Selection;
	supportsPopover: () => boolean;
	showPopover: (panel: Element) => void;
	hidePopover: (panel: Element) => void;
	isFocusVisible: (element: Element) => boolean;
}

export interface HighlightPreviews {
	hide(): void;
	reposition(): void;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function attributeOf(input: { element: Element; name: string }): string {
	const value = input.element.getAttribute(input.name);
	assert(value, `the element carries ${input.name}`);
	return value;
}

const inactive: HighlightPreviews = { hide: () => undefined, reposition: () => undefined };

export function initHighlightPreviews(deps: HighlightPreviewDeps): HighlightPreviews {
	if (!deps.supportsPopover()) return inactive;
	const { document } = deps;
	let shown: { id: string; preview: HTMLElement } | undefined;
	let pinned = false;
	let pending: { id: string; handle: unknown } | undefined;
	let grace: unknown;
	let hoveredId: string | undefined;
	let keyboardFocused: HTMLElement | undefined;

	const previewOf = (id: string): HTMLElement | null => document.getElementById(`${PREVIEW_ID_PREFIX}${id}`);

	const segmentsOf = (id: string): HTMLElement[] =>
		Array.from(document.querySelectorAll<HTMLElement>(`${MARK_SELECTOR}[data-highlight-id="${id}"]`));

	const notedIdOnPath = (path: readonly EventTarget[]): string | undefined => {
		const preview = Array.from(document.querySelectorAll(`[${PREVIEW_ATTRIBUTE}]`)).find((candidate) =>
			path.includes(candidate),
		);
		if (preview !== undefined) return attributeOf({ element: preview, name: PREVIEW_ATTRIBUTE });
		const mark = Array.from(document.querySelectorAll(MARK_SELECTOR))
			.filter((candidate) => path.includes(candidate))
			.filter((candidate) => previewOf(attributeOf({ element: candidate, name: "data-highlight-id" })) !== null)
			.at(-1);
		return mark?.getAttribute("data-highlight-id") ?? undefined;
	};

	const interactiveOnPath = (path: readonly EventTarget[]): boolean =>
		Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR)).some((candidate) => path.includes(candidate));

	const articleSelectionOpen = (): boolean => {
		const selection = deps.selectionOf();
		const content = document.querySelector(CONTENT_SELECTOR);
		return !selection.isCollapsed && content !== null && content.contains(selection.anchorNode);
	};

	const cancelPending = (): void => {
		if (pending !== undefined) deps.timers.clearTimeout(pending.handle);
		pending = undefined;
	};

	const cancelGrace = (): void => {
		deps.timers.clearTimeout(grace);
		grace = undefined;
	};

	const forgetRemoved = (): void => {
		if (shown === undefined || shown.preview.isConnected) return;
		cancelGrace();
		shown = undefined;
		pinned = false;
	};

	const place = (): void => {
		forgetRemoved();
		if (shown === undefined) return;
		const rects = segmentsOf(shown.id).flatMap((segment) => {
			const range = document.createRange();
			range.selectNodeContents(segment);
			return deps.rectsOf(range);
		});
		assert(rects.length > 0, "a shown preview's highlight has client rects");
		const size = shown.preview.getBoundingClientRect();
		const viewport = deps.window.visualViewport;
		const { top, left } = placeClearOfPassage({
			rects,
			panel: { width: size.width, height: size.height },
			viewport: {
				width: viewport.width,
				height: viewport.height,
				offsetLeft: viewport.offsetLeft,
				offsetTop: viewport.offsetTop,
			},
			order: ["above", "below"],
			whenNoneFits: "inside-viewport",
		});
		shown.preview.style.top = `${top}px`;
		shown.preview.style.left = `${left}px`;
	};

	const hide = (): void => {
		cancelPending();
		cancelGrace();
		forgetRemoved();
		if (shown !== undefined) {
			shown.preview.classList.remove(PINNED_CLASS);
			deps.hidePopover(shown.preview);
		}
		shown = undefined;
		pinned = false;
	};

	const show = (id: string): void => {
		if (shown?.id === id && shown.preview.isConnected) return;
		hide();
		const preview = previewOf(id);
		assert(preview, "a noted highlight renders its preview");
		deps.showPopover(preview);
		shown = { id, preview };
		place();
	};

	const pin = (id: string): void => {
		show(id);
		cancelPending();
		cancelGrace();
		pinned = true;
		previewOf(id)?.classList.add(PINNED_CLASS);
		place();
	};

	const keyboardOn = (id: string): boolean => keyboardFocused?.getAttribute("data-highlight-id") === id;

	const startGrace = (): void => {
		if (shown === undefined || pinned) return;
		cancelGrace();
		grace = deps.timers.setTimeout(() => {
			grace = undefined;
			hide();
		}, HOVER_GRACE_MS);
	};

	const tabStops = (): HTMLElement[] =>
		Array.from(document.querySelectorAll(`[${PREVIEW_ATTRIBUTE}]`)).flatMap((preview) => {
			const id = attributeOf({ element: preview, name: PREVIEW_ATTRIBUTE });
			const stop = segmentsOf(id).find((segment) => segment.closest(INTERACTIVE_SELECTOR) === null);
			return stop === undefined ? [] : [stop];
		});

	const applyTabStops = (): void => {
		for (const stop of tabStops()) {
			const id = attributeOf({ element: stop, name: "data-highlight-id" });
			stop.setAttribute("tabindex", "0");
			stop.setAttribute("aria-describedby", `${PREVIEW_ID_PREFIX}${id}`);
		}
	};

	const scheduleShow = (id: string): void => {
		if (pending?.id === id) return;
		cancelPending();
		pending = {
			id,
			handle: deps.timers.setTimeout(() => {
				pending = undefined;
				if (pinned || articleSelectionOpen() || previewOf(id) === null) return;
				show(id);
			}, HOVER_SHOW_MS),
		};
	};

	const isMouse = (event: Event): boolean => Reflect.get(event, "pointerType") === "mouse";

	document.addEventListener("pointerover", (event) => {
		if (!isMouse(event)) return;
		const id = notedIdOnPath(event.composedPath());
		hoveredId = id;
		if (pending !== undefined && pending.id !== id) cancelPending();
		if (id === undefined) return;
		if (shown?.id === id) {
			cancelGrace();
			return;
		}
		const ready =
			!pinned &&
			Reflect.get(event, "buttons") === 0 &&
			deps.window.matchMedia(HOVER_QUERY).matches &&
			!articleSelectionOpen();
		if (ready) scheduleShow(id);
	});

	document.addEventListener("pointerout", (event) => {
		if (!isMouse(event)) return;
		if (Reflect.get(event, "relatedTarget") === null) {
			hoveredId = undefined;
			cancelPending();
		}
		if (shown !== undefined && !keyboardOn(shown.id)) startGrace();
	});

	document.addEventListener("pointerdown", (event) => {
		cancelPending();
		if (shown === undefined) return;
		const path = event.composedPath();
		const inside = path.includes(shown.preview) || segmentsOf(shown.id).some((segment) => path.includes(segment));
		if (!inside) hide();
	});

	document.addEventListener("focusin", (event) => {
		const stop = tabStops().find((candidate) => candidate === event.target);
		if (stop === undefined || !deps.isFocusVisible(stop)) return;
		keyboardFocused = stop;
		const id = attributeOf({ element: stop, name: "data-highlight-id" });
		cancelGrace();
		if (!pinned) show(id);
	});

	document.addEventListener("focusout", (event) => {
		if (keyboardFocused === undefined || event.target !== keyboardFocused) return;
		keyboardFocused = undefined;
		if (shown !== undefined && hoveredId !== shown.id) startGrace();
	});

	document.addEventListener("click", (event) => {
		if (articleSelectionOpen()) return;
		const path = event.composedPath();
		const id = interactiveOnPath(path) ? undefined : notedIdOnPath(path);
		if (id === undefined) hide();
		else pin(id);
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			hide();
			return;
		}
		if (event.key !== "Enter" && event.key !== " ") return;
		if (keyboardFocused === undefined || event.target !== keyboardFocused) return;
		event.preventDefault();
		if (!event.repeat) keyboardFocused.click();
	});

	document.addEventListener("htmx:afterSettle", () => {
		cancelPending();
		forgetRemoved();
		applyTabStops();
	});

	applyTabStops();
	return { hide, reposition: place };
}
