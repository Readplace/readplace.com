import {
	type PassageRect,
	type PlacementViewport,
	passageRectsOf,
	pickPassageMode,
	placeByMode,
	VIEWPORT_GUTTER_PX,
} from "./place-clear-of-passage";

const EDITOR_ATTRIBUTE = "data-highlight-note-editor";
const TOOLBAR_QUOTE_SELECTOR = `[${EDITOR_ATTRIBUTE}=""] [data-highlight-note-quote]`;

export interface HighlightNoteEditorDeps {
	document: Document;
	window: { readonly visualViewport: PlacementViewport };
	rectsOf: (range: Range) => readonly PassageRect[];
	isOpen: (popover: Element) => boolean;
	schedule: () => void;
}

export interface HighlightNoteEditors {
	reposition(): void;
	isOpen(): boolean;
	handOver(input: { range: Range; quote: string }): void;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function onScreen(input: { rects: readonly PassageRect[]; viewport: PlacementViewport }): boolean {
	const { offsetTop, offsetLeft, width, height } = input.viewport;
	return input.rects.some(
		(rect) =>
			rect.bottom > offsetTop &&
			rect.top < offsetTop + height &&
			rect.left + rect.width > offsetLeft &&
			rect.left < offsetLeft + width,
	);
}

export function initHighlightNoteEditors(deps: HighlightNoteEditorDeps): HighlightNoteEditors {
	const { document } = deps;
	let shown: HTMLElement | undefined;
	let handed: Range | undefined;

	const forgetClosed = (): void => {
		if (shown !== undefined && (!shown.isConnected || !deps.isOpen(shown))) shown = undefined;
	};

	const passageOf = (editor: HTMLElement): readonly PassageRect[] => {
		const id = editor.getAttribute(EDITOR_ATTRIBUTE);
		if (id) return passageRectsOf({ document, rectsOf: deps.rectsOf, id });
		return handed === undefined ? [] : deps.rectsOf(handed);
	};

	const place = (editor: HTMLElement): void => {
		const { width, height, offsetLeft, offsetTop } = deps.window.visualViewport;
		const viewport = { width, height, offsetLeft, offsetTop };
		editor.style.maxHeight = `${height - 2 * VIEWPORT_GUTTER_PX}px`;
		const size = editor.getBoundingClientRect();
		const panel = { width: size.width, height: size.height };
		const rects = passageOf(editor);
		const mode = onScreen({ rects, viewport }) ? pickPassageMode({ rects, panel, viewport }) : "docked";
		const { top, left } = placeByMode({ mode, dock: "centred", rects, panel, viewport });
		editor.style.top = `${top}px`;
		editor.style.bottom = "auto";
		editor.style.left = `${left}px`;
	};

	document.addEventListener(
		"beforetoggle",
		(event) => {
			const editor = Array.from(document.querySelectorAll<HTMLElement>(`[${EDITOR_ATTRIBUTE}]`)).find(
				(candidate) => candidate === event.target,
			);
			if (editor === undefined || Reflect.get(event, "newState") !== "open") return;
			shown = editor;
			deps.schedule();
		},
		true,
	);

	document.addEventListener("htmx:afterSettle", () => deps.schedule());

	return {
		reposition: () => {
			forgetClosed();
			if (shown !== undefined) place(shown);
		},
		isOpen: () => {
			forgetClosed();
			return shown !== undefined;
		},
		handOver: (input) => {
			const quote = document.querySelector(TOOLBAR_QUOTE_SELECTOR);
			assert(quote, "the toolbar's note editor carries its quote");
			quote.textContent = input.quote;
			handed = input.range;
		},
	};
}
