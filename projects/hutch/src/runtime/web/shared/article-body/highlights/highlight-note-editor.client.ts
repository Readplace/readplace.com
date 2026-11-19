import {
	type PassageMode,
	type PassageRect,
	type PlacementViewport,
	passageRectsOf,
	pickPassageMode,
	placeByMode,
	sideFits,
	VIEWPORT_GUTTER_PX,
} from "./place-clear-of-passage";

const EDITOR_ATTRIBUTE = "data-highlight-note-editor";
const TOOLBAR_QUOTE_SELECTOR = `[${EDITOR_ATTRIBUTE}=""] [data-highlight-note-quote]`;

interface EditorViewport extends PlacementViewport {
	addEventListener(type: "resize", listener: () => void): void;
}

export interface HighlightNoteEditorDeps {
	document: Document;
	window: { readonly visualViewport: EditorViewport };
	rectsOf: (range: Range) => readonly PassageRect[];
	isOpen: (popover: Element) => boolean;
	schedule: () => void;
}

export interface HighlightNoteEditors {
	reposition(): void;
	isOpen(): boolean;
	handOver(input: { range: Range; quote: string }): void;
}

interface OpenEditor {
	editor: HTMLElement;
	mode: PassageMode | undefined;
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
	let shown: OpenEditor | undefined;
	let handed: Range | undefined;

	const forgetClosed = (): void => {
		if (shown !== undefined && (!shown.editor.isConnected || !deps.isOpen(shown.editor))) shown = undefined;
	};

	const passageOf = (editor: HTMLElement): readonly PassageRect[] => {
		const id = editor.getAttribute(EDITOR_ATTRIBUTE);
		if (id) return passageRectsOf({ document, rectsOf: deps.rectsOf, id });
		return handed === undefined ? [] : deps.rectsOf(handed);
	};

	const place = (open: OpenEditor): void => {
		const { width, height, offsetLeft, offsetTop } = deps.window.visualViewport;
		const viewport = { width, height, offsetLeft, offsetTop };
		open.editor.style.maxHeight = `${height - 2 * VIEWPORT_GUTTER_PX}px`;
		const size = open.editor.getBoundingClientRect();
		const panel = { width: size.width, height: size.height };
		const rects = passageOf(open.editor);
		const visible = onScreen({ rects, viewport });
		const mode = open.mode;
		const stale =
			mode === undefined ||
			(mode !== "docked" &&
				(rects.length === 0 || (visible && !sideFits({ side: mode, rects, panel, viewport }))));
		const next = stale ? (visible ? pickPassageMode({ rects, panel, viewport }) : "docked") : mode;
		open.mode = next;
		const { top, left } = placeByMode({ mode: next, dock: "centred", rects, panel, viewport });
		open.editor.style.top = `${top}px`;
		open.editor.style.bottom = "auto";
		open.editor.style.left = `${left}px`;
	};

	const repick = (): void => {
		if (shown !== undefined) shown.mode = undefined;
	};

	document.addEventListener(
		"beforetoggle",
		(event) => {
			const editor = Array.from(document.querySelectorAll<HTMLElement>(`[${EDITOR_ATTRIBUTE}]`)).find(
				(candidate) => candidate === event.target,
			);
			if (editor === undefined || Reflect.get(event, "newState") !== "open") return;
			shown = { editor, mode: undefined };
			deps.schedule();
		},
		true,
	);

	document.addEventListener("htmx:afterSettle", () => {
		repick();
		deps.schedule();
	});

	deps.window.visualViewport.addEventListener("resize", repick);

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
