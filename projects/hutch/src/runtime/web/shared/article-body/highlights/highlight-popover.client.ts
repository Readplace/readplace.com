import { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";
import {
	type PassageRect,
	type PlacementViewport,
	placeClearOfPassage,
	TOOLBAR_GAP_PX,
	VIEWPORT_GUTTER_PX,
} from "./place-clear-of-passage";

export const PANEL_ATTRIBUTE = "data-highlight-popover";
export const PANEL_HINT_ID = "manage-highlight-hint";
const PANEL_ID_PREFIX = "manage-highlight-";
const INTERACTIVE_SELECTOR = "a[href], button, input, select, textarea, summary, label";
const MARK_SELECTOR = `.${ARTICLE_HIGHLIGHT_CLASS}`;
const OPENER_SELECTOR = '[popovertarget]:not([popovertargetaction="hide"])';
const OTHER_DIALOGS_SELECTOR = `[popover][role="dialog"]:not([${PANEL_ATTRIBUTE}])`;
const OPENING_KEYS: readonly string[] = ["Enter", " "];

interface PanelViewport extends PlacementViewport {
	addEventListener(type: "resize", listener: () => void): void;
}

export interface HighlightPanelDeps {
	document: Document;
	window: { readonly visualViewport: PanelViewport };
	rectsOf: (range: Range) => readonly PassageRect[];
	showPopover: (panel: Element) => void;
	hidePopover: (panel: Element) => void;
	isOpen: (popover: Element) => boolean;
}

export interface HighlightPanels {
	has(id: string): boolean;
	open(id: string): boolean;
	quietsPreview(): boolean;
	reposition(): void;
	restoreFocus(): void;
}

type PanelMode = "above" | "below" | "docked";

interface OpenPanel {
	id: string;
	panel: HTMLElement;
	mode: PanelMode | undefined;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function idOf(panel: Element): string {
	const id = panel.getAttribute(PANEL_ATTRIBUTE);
	assert(id, "a highlight's panel names its highlight");
	return id;
}

function isElement(target: unknown): target is Element {
	return typeof Reflect.get(Object(target), "closest") === "function";
}

export function highlightTabStop(input: { document: Document; id: string }): HTMLElement | undefined {
	return Array.from(
		input.document.querySelectorAll<HTMLElement>(`${MARK_SELECTOR}[data-highlight-id="${input.id}"]`),
	).find((segment) => segment.closest(INTERACTIVE_SELECTOR) === null);
}

export function initHighlightPanels(deps: HighlightPanelDeps): HighlightPanels {
	const { document } = deps;
	let shown: OpenPanel | undefined;
	let opening = false;
	let heldKey: string | undefined;
	let chain: string | undefined;
	let remembered: readonly string[] | undefined;
	let pressing: string | undefined;

	const panelOf = (id: string): HTMLElement | null => document.getElementById(`${PANEL_ID_PREFIX}${id}`);

	const panelIds = (): string[] =>
		Array.from(document.querySelectorAll(`[${PANEL_ATTRIBUTE}]`), idOf);

	const otherDialogOpen = (): boolean => Array.from(document.querySelectorAll(OTHER_DIALOGS_SELECTOR)).some(deps.isOpen);

	const forgetClosed = (): void => {
		if (shown !== undefined && (!shown.panel.isConnected || !deps.isOpen(shown.panel))) shown = undefined;
	};

	const passageRects = (id: string): PassageRect[] =>
		Array.from(document.querySelectorAll(`${MARK_SELECTOR}[data-highlight-id="${id}"]`)).flatMap((segment) => {
			const range = document.createRange();
			range.selectNodeContents(segment);
			return deps.rectsOf(range);
		});

	const place = (open: OpenPanel): void => {
		const rects = passageRects(open.id);
		assert(rects.length > 0, "an open panel's highlight has client rects");
		const size = open.panel.getBoundingClientRect();
		const { width, height, offsetLeft, offsetTop } = deps.window.visualViewport;
		const viewport = { width, height, offsetLeft, offsetTop };
		const panel = { width: size.width, height: size.height };
		if (open.mode === undefined) {
			const chosen = placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects,
				panel,
				viewport,
				order: ["above", "below"],
				whenNoneFits: "inside-viewport",
			});
			open.mode = chosen.clear ? chosen.side : "docked";
		}
		const { top, left } =
			open.mode === "docked"
				? { top: offsetTop + height - VIEWPORT_GUTTER_PX - size.height, left: offsetLeft + VIEWPORT_GUTTER_PX }
				: placeClearOfPassage({ gap: TOOLBAR_GAP_PX, rects, panel, viewport, order: [open.mode], whenNoneFits: "last-side" });
		open.panel.style.top = `${top}px`;
		open.panel.style.left = `${left}px`;
		open.panel.style.maxWidth = `${width - 2 * VIEWPORT_GUTTER_PX}px`;
	};

	const open = (id: string): boolean => {
		const panel = panelOf(id);
		if (panel === null || otherDialogOpen()) return false;
		const stop = highlightTabStop({ document, id });
		assert(stop, "a highlight opened from the page has a tab stop on it");
		opening = true;
		if (document.activeElement !== stop) stop.focus({ preventScroll: true });
		deps.showPopover(panel);
		opening = false;
		heldKey = pressing;
		shown = { id, panel, mode: undefined };
		place(shown);
		return true;
	};

	const neighboursOf = (id: string): string[] => {
		const ids = panelIds();
		const index = ids.indexOf(id);
		return [ids[index + 1], ids[index - 1]].filter((neighbour) => neighbour !== undefined);
	};

	const focusedHighlight = (): string | undefined => {
		const active = document.activeElement;
		assert(active, "a live reader document always has an active element");
		const panel = active.closest(`[${PANEL_ATTRIBUTE}]`);
		if (panel !== null) return deps.isOpen(panel) ? idOf(panel) : undefined;
		if (!active.matches(`${MARK_SELECTOR}[tabindex="0"]`)) return undefined;
		const id = active.getAttribute("data-highlight-id");
		assert(id, "a highlight's tab stop names its highlight");
		return id;
	};

	const inside = (input: { target: EventTarget | null; selector: string }): boolean =>
		isElement(input.target) && input.target.closest(input.selector) !== null;

	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === heldKey && inside({ target: event.target, selector: `[${PANEL_ATTRIBUTE}]` })) {
				event.preventDefault();
			}
			pressing = OPENING_KEYS.includes(event.key) && !event.repeat ? event.key : undefined;
		},
		true,
	);

	document.addEventListener("pointerdown", () => {
		pressing = undefined;
	}, true);

	document.addEventListener(
		"keyup",
		(event) => {
			if (event.key === pressing) pressing = undefined;
			if (event.key !== heldKey) return;
			heldKey = undefined;
			if (inside({ target: event.target, selector: `[${PANEL_ATTRIBUTE}]` })) event.preventDefault();
		},
		true,
	);

	document.addEventListener("click", (event) => {
		const elements = event.composedPath().filter(isElement);
		const panel = elements.find((element) => element.hasAttribute(PANEL_ATTRIBUTE));
		const action = elements.find((element) => element.matches("button"));
		if (panel !== undefined && action !== undefined) {
			chain = idOf(panel);
			opening = true;
			deps.hidePopover(panel);
			opening = false;
			shown = undefined;
			return;
		}
		if (elements.some((element) => element.matches(OPENER_SELECTOR))) chain = undefined;
	});

	document.addEventListener(
		"submit",
		(event) => {
			if (chain === undefined) return;
			const submitter = Reflect.get(event, "submitter");
			const fromChain =
				inside({ target: event.target, selector: `#note-highlight-${chain}, #delete-highlight-${chain}` }) ||
				inside({ target: isElement(submitter) ? submitter : null, selector: `#${PANEL_ID_PREFIX}${chain}` });
			if (fromChain) remembered = [chain, ...neighboursOf(chain)];
		},
		true,
	);

	document.addEventListener("htmx:afterRequest", (event) => {
		if (Reflect.get(Object(Reflect.get(event, "detail")), "successful") !== true) remembered = undefined;
	});

	document.addEventListener("htmx:beforeSwap", () => {
		if (remembered !== undefined) return;
		const id = focusedHighlight();
		if (id !== undefined) remembered = [id];
	});

	deps.window.visualViewport.addEventListener("resize", () => {
		if (shown !== undefined) shown.mode = undefined;
	});

	return {
		has: (id) => panelOf(id) !== null,
		open,
		quietsPreview: () => {
			forgetClosed();
			return opening || shown !== undefined;
		},
		reposition: () => {
			forgetClosed();
			if (shown !== undefined) place(shown);
		},
		restoreFocus: () => {
			const ids = remembered;
			remembered = undefined;
			if (ids === undefined || document.activeElement !== document.body) return;
			const stop = ids.map((id) => highlightTabStop({ document, id })).find((candidate) => candidate !== undefined);
			stop?.focus({ preventScroll: true });
		},
	};
}
