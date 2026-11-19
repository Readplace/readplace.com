import { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";

export const TOOLBAR_GAP_PX = 10;
export const VIEWPORT_GUTTER_PX = 16;

export interface PassageRect {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly width: number;
}

type PassageSide = "above" | "below";

export interface PlacementViewport {
	readonly width: number;
	readonly height: number;
	readonly offsetLeft: number;
	readonly offsetTop: number;
}

export interface ClearPlacement {
	top: number;
	left: number;
	side: PassageSide;
	clear: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export function placeClearOfPassage(input: {
	gap: number;
	rects: readonly PassageRect[];
	panel: { width: number; height: number };
	viewport: PlacementViewport;
	order: readonly [PassageSide, ...PassageSide[]];
	whenNoneFits: "last-side" | "inside-viewport";
}): ClearPlacement {
	const { gap, rects, panel, viewport, order } = input;
	assert(rects.length > 0, "a selection holding text has client rects");
	const boxTop = Math.min(...rects.map((rect) => rect.top));
	const boxBottom = Math.max(...rects.map((rect) => rect.bottom));
	const viewportBottom = viewport.offsetTop + viewport.height;

	const topOf = (side: PassageSide): number => (side === "above" ? boxTop - gap - panel.height : boxBottom + gap);
	const fits = (side: PassageSide): boolean =>
		side === "above" ? topOf(side) >= viewport.offsetTop : topOf(side) + panel.height <= viewportBottom;
	const leftOf = (side: PassageSide): number => {
		const anchor = side === "above" ? rects[0] : rects[rects.length - 1];
		const centred = anchor.left + anchor.width / 2 - panel.width / 2;
		const maxLeft = viewport.offsetLeft + viewport.width - panel.width - VIEWPORT_GUTTER_PX;
		const minLeft = viewport.offsetLeft + VIEWPORT_GUTTER_PX;
		return Math.max(Math.min(centred, maxLeft), minLeft);
	};

	const fitting = order.find(fits);
	if (fitting !== undefined) return { top: topOf(fitting), left: leftOf(fitting), side: fitting, clear: true };
	const side = order[order.length - 1];
	if (input.whenNoneFits === "last-side") return { top: topOf(side), left: leftOf(side), side, clear: true };
	const highest = viewport.offsetTop + VIEWPORT_GUTTER_PX;
	const lowest = viewportBottom - VIEWPORT_GUTTER_PX - panel.height;
	return { top: Math.max(Math.min(topOf(side), lowest), highest), left: leftOf(side), side, clear: false };
}

export type PassageMode = PassageSide | "docked";

interface PassagePlacementInput {
	rects: readonly PassageRect[];
	panel: { width: number; height: number };
	viewport: PlacementViewport;
}

export function pickPassageMode(input: PassagePlacementInput): PassageMode {
	const chosen = placeClearOfPassage({
		gap: TOOLBAR_GAP_PX,
		...input,
		order: ["above", "below"],
		whenNoneFits: "inside-viewport",
	});
	return chosen.clear ? chosen.side : "docked";
}

export function sideFits(input: PassagePlacementInput & { side: PassageSide }): boolean {
	const { side, ...placement } = input;
	return placeClearOfPassage({ gap: TOOLBAR_GAP_PX, ...placement, order: [side], whenNoneFits: "inside-viewport" }).clear;
}

export function placeByMode(
	input: PassagePlacementInput & { mode: PassageMode; dock: "gutter" | "centred" },
): { top: number; left: number } {
	const { mode, dock, panel, viewport } = input;
	if (mode !== "docked") {
		const { top, left } = placeClearOfPassage({
			gap: TOOLBAR_GAP_PX,
			rects: input.rects,
			panel,
			viewport,
			order: [mode],
			whenNoneFits: "last-side",
		});
		return { top, left };
	}
	const top = viewport.offsetTop + viewport.height - VIEWPORT_GUTTER_PX - panel.height;
	const left =
		dock === "gutter"
			? viewport.offsetLeft + VIEWPORT_GUTTER_PX
			: viewport.offsetLeft + (viewport.width - panel.width) / 2;
	return { top, left };
}

export function passageRectsOf(input: {
	document: Document;
	rectsOf: (range: Range) => readonly PassageRect[];
	id: string;
}): PassageRect[] {
	const { document } = input;
	return Array.from(
		document.querySelectorAll(`.${ARTICLE_HIGHLIGHT_CLASS}[data-highlight-id="${input.id}"]`),
	).flatMap((segment) => {
		const range = document.createRange();
		range.selectNodeContents(segment);
		return input.rectsOf(range);
	});
}
