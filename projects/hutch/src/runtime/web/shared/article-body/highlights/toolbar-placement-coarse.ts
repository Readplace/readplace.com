export const TOOLBAR_GAP_PX = 10;
export const VIEWPORT_GUTTER_PX = 16;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface PlacementRect {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly width: number;
}

export function placeBelowSelection(params: {
	rects: readonly PlacementRect[];
	toolbar: { width: number; height: number };
	viewport: {
		width: number;
		height: number;
		offsetLeft: number;
		offsetTop: number;
	};
}): { left: number; top: number } {
	const { rects, toolbar, viewport } = params;
	assert(rects.length > 0, "a selection holding text has client rects");
	const first = rects[0];
	const last = rects[rects.length - 1];
	const below = last.bottom + TOOLBAR_GAP_PX;
	const fitsBelow = below + toolbar.height <= viewport.offsetTop + viewport.height;
	const anchor = fitsBelow ? last : first;
	const top = fitsBelow ? below : first.top - TOOLBAR_GAP_PX - toolbar.height;
	const centred = anchor.left + anchor.width / 2 - toolbar.width / 2;
	const maxLeft = viewport.offsetLeft + viewport.width - toolbar.width - VIEWPORT_GUTTER_PX;
	const minLeft = viewport.offsetLeft + VIEWPORT_GUTTER_PX;
	return { left: Math.max(Math.min(centred, maxLeft), minLeft), top };
}
