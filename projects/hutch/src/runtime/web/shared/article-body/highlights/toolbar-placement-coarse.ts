import {
	type PassageRect,
	type PlacementViewport,
	placeClearOfPassage,
	VIEWPORT_GUTTER_PX,
} from "./place-clear-of-passage";

export const SYSTEM_MENU_CLEARANCE_PX = 64;

function visibleFloorTop(input: { viewport: PlacementViewport; floorTop: number | undefined }): number | undefined {
	const { viewport, floorTop } = input;
	const viewportBottom = viewport.offsetTop + viewport.height;
	return floorTop !== undefined && floorTop > viewport.offsetTop && floorTop < viewportBottom ? floorTop : undefined;
}

export function dockToViewportBottom(params: {
	toolbar: { width: number; height: number };
	viewport: PlacementViewport;
	floorTop: number | undefined;
}): { left: number; top: number } {
	const { toolbar, viewport } = params;
	const edge = visibleFloorTop(params) ?? viewport.offsetTop + viewport.height;
	const centred = (viewport.width - toolbar.width) / 2;
	return {
		top: edge - VIEWPORT_GUTTER_PX - toolbar.height,
		left: viewport.offsetLeft + Math.max(centred, VIEWPORT_GUTTER_PX),
	};
}

export function placeNearSelection(params: {
	rects: readonly PassageRect[];
	toolbar: { width: number; height: number };
	viewport: PlacementViewport;
	floorTop: number | undefined;
}): { left: number; top: number } {
	const { rects, toolbar, viewport } = params;
	if (rects.length === 0) return dockToViewportBottom(params);
	const floorTop = visibleFloorTop(params);
	const room = floorTop === undefined ? viewport : { ...viewport, height: floorTop - viewport.offsetTop };
	const placement = placeClearOfPassage({
		gap: SYSTEM_MENU_CLEARANCE_PX,
		rects,
		panel: toolbar,
		viewport: room,
		order: ["below", "above"],
		whenNoneFits: "inside-viewport",
	});
	if (!placement.clear) return dockToViewportBottom(params);
	return { top: placement.top, left: placement.left };
}
