import { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";
import type { PassageRect } from "./place-clear-of-passage";
import { placeNoteEditor } from "./place-note-editor";

const SHEET_SPACE_PROPERTY = "--confirm-popover-sheet-space";
const EDITOR_SELECTOR = "[data-highlight-note-editor]";
const EDIT_EDITOR_ID_PREFIX = "note-highlight-";
const RAIL_SELECTOR = ".highlights-rail";
const ROW_SELECTOR = "[data-highlight-row]";
const QUOTE_SELECTOR = "blockquote";
const COLUMN_SELECTOR = ".article-body__content";
const CHROME_SELECTORS = [RAIL_SELECTOR, ".reading-layout__top"];

type NoteEditorTrigger = Parameters<typeof placeNoteEditor>[0]["trigger"];

interface NoteEditorViewport {
	readonly width: number;
	readonly height: number;
	readonly offsetLeft: number;
	readonly offsetTop: number;
	addEventListener(type: "resize", listener: () => void): void;
}

interface NoteEditorWindow {
	readonly visualViewport: NoteEditorViewport;
	scrollBy(options: { top: number }): void;
}

interface NoteEditorDeps {
	document: Document;
	window: NoteEditorWindow;
	rectsOf: (range: Range) => readonly PassageRect[];
	hidePopover: (panel: Element) => void;
	isAutoPopoverOpen: () => boolean;
	paintDraft: (range: Range) => void;
	clearDraft: () => void;
	chromeBottom: () => number;
	hideOtherSurfaces: () => void;
	requestReposition: () => void;
}

export interface NoteEditors {
	openCreate(input: {
		panel: HTMLElement;
		range: Range;
		show: () => void;
	}): void;
	isOpen(): boolean;
	reposition(): void;
}

interface OpenEditor {
	panel: HTMLElement;
	drafted: boolean;
	passage: () => PassageRect[];
	height: number;
	next: NoteEditorTrigger;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(target: unknown): target is Element {
	return typeof Reflect.get(Object(target), "closest") === "function";
}

function boxOf(element: Element): PassageRect {
	const { top, bottom, left, width } = element.getBoundingClientRect();
	return { top, bottom, left, width };
}

export function initNoteEditors(deps: NoteEditorDeps): NoteEditors {
	const { document, window } = deps;
	const root = document.documentElement;
	let open: OpenEditor | undefined;
	let openedFromRail = false;

	const rectsOfContents = (elements: Iterable<Element>): PassageRect[] =>
		[...elements].flatMap((element) => {
			const range = document.createRange();
			range.selectNodeContents(element);
			return [...deps.rectsOf(range)];
		});

	const onScreen = (rects: readonly PassageRect[]): boolean => {
		const viewport = window.visualViewport;
		const top = Math.max(viewport.offsetTop, deps.chromeBottom());
		const bottom = viewport.offsetTop + viewport.height;
		return rects.some((rect) => rect.bottom > top && rect.top < bottom);
	};

	const forget = (): void => {
		if (open?.drafted) deps.clearDraft();
		open = undefined;
		root.style.removeProperty(SHEET_SPACE_PROPERTY);
	};

	const tracked = (): OpenEditor | undefined => {
		if (open !== undefined && !open.panel.isConnected) forget();
		return open;
	};

	const take = (editor: OpenEditor): void => {
		deps.hideOtherSurfaces();
		const previous = tracked();
		if (previous !== undefined) {
			deps.hidePopover(previous.panel);
			if (previous.drafted) deps.clearDraft();
		}
		open = editor;
	};

	const place = (editor: OpenEditor, trigger: NoteEditorTrigger): void => {
		const { panel } = editor;
		const viewport = window.visualViewport;
		panel.style.width = "";
		panel.style.maxHeight = "";
		const size = panel.getBoundingClientRect();
		const column = document.querySelector(COLUMN_SELECTOR);
		assert(column, "a note editor opens over an article column");
		const placement = placeNoteEditor({
			rects: editor.passage(),
			editor: { width: size.width, height: size.height },
			viewport: {
				width: viewport.width,
				height: viewport.height,
				offsetLeft: viewport.offsetLeft,
				offsetTop: viewport.offsetTop,
			},
			topInset: deps.chromeBottom(),
			column: boxOf(column),
			chrome: CHROME_SELECTORS.flatMap((selector) =>
				[...document.querySelectorAll(selector)].map(boxOf),
			),
			trigger,
		});
		panel.style.top = `${placement.top}px`;
		panel.style.left = `${placement.left}px`;
		panel.style.width = `${placement.width}px`;
		panel.style.bottom = "auto";
		panel.style.right = "auto";
		panel.style.margin = "0px";
		panel.style.maxHeight =
			placement.maxHeight === undefined ? "" : `${placement.maxHeight}px`;
		root.style.setProperty(SHEET_SPACE_PROPERTY, `${placement.bottomSpace}px`);
		if (placement.scrollBy !== 0) window.scrollBy({ top: placement.scrollBy });
		editor.next = { reason: "scroll", mode: placement.mode };
		editor.height = viewport.height;
	};

	const marksOf = (id: string | null): NodeListOf<Element> =>
		document.querySelectorAll(
			`.${ARTICLE_HIGHLIGHT_CLASS}[data-highlight-id="${id}"]`,
		);

	const editPassage = (row: Element): (() => PassageRect[]) => {
		const id = row.getAttribute("data-highlight-row");
		const marks = (): PassageRect[] => rectsOfContents(marksOf(id));
		const quote = (): PassageRect[] =>
			rectsOfContents(row.querySelectorAll(QUOTE_SELECTOR));
		const marksShown = onScreen(marks());
		const quoteShown = onScreen(quote());
		if (marksShown && quoteShown) return () => [...marks(), ...quote()];
		if (marksShown) return marks;
		if (quoteShown) return quote;
		return openedFromRail ? quote : marks;
	};

	document.addEventListener(
		"click",
		(event) => {
			const trigger = isElement(event.target)
				? event.target.closest("[popovertarget]")
				: null;
			if (trigger !== null)
				openedFromRail = trigger.closest(RAIL_SELECTOR) !== null;
		},
		true,
	);

	document.addEventListener(
		"beforetoggle",
		(event) => {
			const target = event.target;
			if (Reflect.get(event, "newState") !== "open" || !isElement(target))
				return;
			const panel = document.getElementById(target.id);
			if (!panel || panel.querySelector(EDITOR_SELECTOR) === null) return;
			const row = document
				.querySelector(`${RAIL_SELECTOR} [popovertarget="${target.id}"]`)
				?.closest(ROW_SELECTOR);
			const highlightId = target.id.slice(EDIT_EDITOR_ID_PREFIX.length);
			const passage = row
				? editPassage(row)
				: marksOf(highlightId).length > 0
					? () => rectsOfContents(marksOf(highlightId))
					: undefined;
			if (passage === undefined) return;
			take({
				panel,
				drafted: false,
				passage,
				height: 0,
				next: { reason: "open" },
			});
			deps.requestReposition();
		},
		true,
	);

	document.addEventListener(
		"toggle",
		(event) => {
			if (
				Reflect.get(event, "newState") === "closed" &&
				open !== undefined &&
				event.target === open.panel
			)
				forget();
		},
		true,
	);

	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || event.isComposing || deps.isAutoPopoverOpen())
			return;
		const editor = tracked();
		if (editor !== undefined) deps.hidePopover(editor.panel);
	});

	document.addEventListener("htmx:afterSettle", () => {
		const editor = tracked();
		if (editor !== undefined) place(editor, { reason: "resize" });
	});

	window.visualViewport.addEventListener("resize", () => {
		const editor = tracked();
		if (editor === undefined) return;
		const typing =
			editor.panel.querySelector("textarea") === document.activeElement;
		editor.next =
			typing && window.visualViewport.height < editor.height
				? { reason: "keyboard" }
				: { reason: "resize" };
	});

	return {
		openCreate: ({ panel, range, show }) => {
			const editor: OpenEditor = {
				panel,
				drafted: true,
				passage: () => [...deps.rectsOf(range)],
				height: 0,
				next: { reason: "open" },
			};
			take(editor);
			deps.paintDraft(range);
			show();
			place(editor, editor.next);
		},
		isOpen: () => tracked() !== undefined,
		reposition: () => {
			const editor = tracked();
			if (editor !== undefined) place(editor, editor.next);
		},
	};
}
