import { type PlacementViewport, VIEWPORT_GUTTER_PX } from "./place-clear-of-passage";

export function dockToViewportBottom(params: {
	toolbar: { width: number; height: number };
	viewport: PlacementViewport;
	floorTop: number | undefined;
}): { left: number; top: number } {
	const { toolbar, viewport, floorTop } = params;
	const viewportBottom = viewport.offsetTop + viewport.height;
	const floorIsVisible = floorTop !== undefined && floorTop > viewport.offsetTop && floorTop < viewportBottom;
	const edge = floorIsVisible ? floorTop : viewportBottom;
	const centred = (viewport.width - toolbar.width) / 2;
	return {
		top: edge - VIEWPORT_GUTTER_PX - toolbar.height,
		left: viewport.offsetLeft + Math.max(centred, VIEWPORT_GUTTER_PX),
	};
}
