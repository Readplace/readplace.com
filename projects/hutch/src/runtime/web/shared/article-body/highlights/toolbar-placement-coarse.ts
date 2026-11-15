import { type PassageRect, type PlacementViewport, placeClearOfPassage } from "./place-clear-of-passage";

export function placeBelowSelection(params: {
	rects: readonly PassageRect[];
	toolbar: { width: number; height: number };
	viewport: PlacementViewport;
}): { left: number; top: number } {
	const { top, left } = placeClearOfPassage({
		rects: params.rects,
		panel: params.toolbar,
		viewport: params.viewport,
		order: ["below", "above"],
		whenNoneFits: "last-side",
	});
	return { left, top };
}
