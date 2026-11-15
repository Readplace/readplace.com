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
	rects: readonly PassageRect[];
	panel: { width: number; height: number };
	viewport: PlacementViewport;
	order: readonly [PassageSide, ...PassageSide[]];
	whenNoneFits: "last-side" | "inside-viewport";
}): ClearPlacement {
	const { rects, panel, viewport, order } = input;
	assert(rects.length > 0, "a selection holding text has client rects");
	const boxTop = Math.min(...rects.map((rect) => rect.top));
	const boxBottom = Math.max(...rects.map((rect) => rect.bottom));
	const viewportBottom = viewport.offsetTop + viewport.height;

	const topOf = (side: PassageSide): number =>
		side === "above" ? boxTop - TOOLBAR_GAP_PX - panel.height : boxBottom + TOOLBAR_GAP_PX;
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
