import {
	type PassageRect,
	type PlacementViewport,
	placeClearOfPassage,
	TOOLBAR_GAP_PX,
	VIEWPORT_GUTTER_PX,
} from "./place-clear-of-passage";
import { dockToViewportBottom } from "./toolbar-placement-coarse";

export const NOTE_EDITOR_MIN_WIDTH_PX = 320;
export const SHEET_MAX_VIEWPORT_FRACTION = 0.5;

type NoteEditorMode = "above" | "below" | "beside" | "sheet";
type PassageSide = "above" | "below";

interface HorizontalBox {
	readonly left: number;
	readonly width: number;
}

type NoteEditorTrigger =
	| { reason: "open" | "keyboard" | "resize" }
	| { reason: "scroll"; mode: NoteEditorMode };

interface NoteEditorScene {
	rects: readonly PassageRect[];
	editor: { width: number; height: number };
	viewport: PlacementViewport;
	topInset: number;
	column: HorizontalBox;
	chrome: readonly PassageRect[];
	trigger: NoteEditorTrigger;
}

export interface NoteEditorPlacement {
	mode: NoteEditorMode;
	top: number;
	left: number;
	width: number;
	maxHeight: number | undefined;
	bottomSpace: number;
	scrollBy: number;
}

interface Span {
	top: number;
	bottom: number;
}

function scrollIntoSpan(input: { target: Span; space: Span }): number {
	const { target, space } = input;
	if (target.top < space.top) return target.top - space.top;
	if (target.bottom > space.bottom) return target.bottom - space.bottom;
	return 0;
}

function visibleSpan(scene: NoteEditorScene): Span {
	const { viewport, topInset } = scene;
	return {
		top: Math.max(viewport.offsetTop, topInset),
		bottom: viewport.offsetTop + viewport.height,
	};
}

function visibleViewport(scene: NoteEditorScene): PlacementViewport {
	const visible = visibleSpan(scene);
	return {
		...scene.viewport,
		offsetTop: visible.top,
		height: visible.bottom - visible.top,
	};
}

function shifted(
	rects: readonly PassageRect[],
	scrollBy: number,
): PassageRect[] {
	return rects.map((rect) => ({
		top: rect.top - scrollBy,
		bottom: rect.bottom - scrollBy,
		left: rect.left,
		width: rect.width,
	}));
}

function passageSpan(rects: readonly PassageRect[]): Span {
	return {
		top: Math.min(...rects.map((rect) => rect.top)),
		bottom: Math.max(...rects.map((rect) => rect.bottom)),
	};
}

function heldInside(input: {
	top: number;
	height: number;
	scene: NoteEditorScene;
}): number {
	const visible = visibleSpan(input.scene);
	const highest = visible.top + VIEWPORT_GUTTER_PX;
	const lowest = visible.bottom - VIEWPORT_GUTTER_PX - input.height;
	return Math.max(Math.min(input.top, lowest), highest);
}

function besidePassage(input: {
	scene: NoteEditorScene;
	rects: readonly PassageRect[];
	scrollBy: number;
}) {
	const { scene, rects, scrollBy } = input;
	const { viewport, column, chrome, editor } = scene;
	const columnRight = column.left + column.width;
	const leftEdge = Math.max(
		viewport.offsetLeft + VIEWPORT_GUTTER_PX,
		...chrome
			.filter((box) => box.left + box.width <= column.left)
			.map((box) => box.left + box.width + VIEWPORT_GUTTER_PX),
	);
	const rightEdge = Math.min(
		viewport.offsetLeft + viewport.width - VIEWPORT_GUTTER_PX,
		...chrome
			.filter((box) => box.left >= columnRight)
			.map((box) => box.left - VIEWPORT_GUTTER_PX),
	);
	const strips = [
		{ left: leftEdge, width: column.left - VIEWPORT_GUTTER_PX - leftEdge },
		{
			left: columnRight + VIEWPORT_GUTTER_PX,
			width: rightEdge - columnRight - VIEWPORT_GUTTER_PX,
		},
	];
	const widest = strips.reduce((best, strip) =>
		strip.width > best.width ? strip : best,
	);
	if (widest.width < NOTE_EDITOR_MIN_WIDTH_PX) return undefined;
	const top = heldInside({
		top: passageSpan(rects).top,
		height: editor.height,
		scene,
	});
	return {
		mode: "beside" as const,
		top,
		left: widest.left,
		width: Math.min(editor.width, widest.width),
		maxHeight: undefined,
		bottomSpace: 0,
		scrollBy,
	};
}

function sheet(input: {
	scene: NoteEditorScene;
	scrolls: boolean;
}): NoteEditorPlacement {
	const { scene, scrolls } = input;
	const { viewport, editor, rects } = scene;
	const maxHeight = viewport.height * SHEET_MAX_VIEWPORT_FRACTION;
	const height = Math.min(editor.height, maxHeight);
	const docked = dockToViewportBottom({
		toolbar: { width: editor.width, height },
		viewport,
		floorTop: undefined,
	});
	const space = {
		top: visibleSpan(scene).top,
		bottom: docked.top - TOOLBAR_GAP_PX,
	};
	const passage = passageSpan(rects);
	const target =
		passage.bottom - passage.top <= space.bottom - space.top
			? passage
			: rects[0];
	return {
		mode: "sheet",
		top: docked.top,
		left: docked.left,
		width: editor.width,
		maxHeight,
		bottomSpace: height + VIEWPORT_GUTTER_PX,
		scrollBy: scrolls ? scrollIntoSpan({ target, space }) : 0,
	};
}

function sideOf(input: {
	scene: NoteEditorScene;
	rects: readonly PassageRect[];
	order: readonly [PassageSide, ...PassageSide[]];
}) {
	const { scene, rects, order } = input;
	return placeClearOfPassage({
		gap: TOOLBAR_GAP_PX,
		rects,
		panel: scene.editor,
		viewport: visibleViewport(scene),
		order,
		whenNoneFits: "last-side",
	});
}

function choose(input: {
	scene: NoteEditorScene;
	scrolls: boolean;
}): NoteEditorPlacement {
	const { scene, scrolls } = input;
	const scrollBy = scrolls
		? scrollIntoSpan({ target: scene.rects[0], space: visibleSpan(scene) })
		: 0;
	const rects = shifted(scene.rects, scrollBy);
	const clear = placeClearOfPassage({
		gap: TOOLBAR_GAP_PX,
		rects,
		panel: scene.editor,
		viewport: visibleViewport(scene),
		order: ["above", "below"],
		whenNoneFits: "inside-viewport",
	});
	if (clear.clear) {
		return {
			mode: clear.side,
			top: clear.top,
			left: clear.left,
			width: scene.editor.width,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy,
		};
	}
	return besidePassage({ scene, rects, scrollBy }) ?? sheet({ scene, scrolls });
}

function keepSide(input: {
	scene: NoteEditorScene;
	side: PassageSide;
}): NoteEditorPlacement {
	const { scene, side } = input;
	const placed = sideOf({ scene, rects: scene.rects, order: [side] });
	const height = scene.editor.height;
	const held = heldInside({ top: placed.top, height, scene });
	const passage = passageSpan(scene.rects);
	const meets = held < passage.bottom && held + height > passage.top;
	return {
		mode: side,
		top: meets ? placed.top : held,
		left: placed.left,
		width: scene.editor.width,
		maxHeight: undefined,
		bottomSpace: 0,
		scrollBy: 0,
	};
}

const KEPT_ON_SCROLL: Record<
	NoteEditorMode,
	(scene: NoteEditorScene) => NoteEditorPlacement
> = {
	above: (scene) => keepSide({ scene, side: "above" }),
	below: (scene) => keepSide({ scene, side: "below" }),
	beside: (scene) =>
		besidePassage({ scene, rects: scene.rects, scrollBy: 0 }) ??
		choose({ scene, scrolls: false }),
	sheet: (scene) => sheet({ scene, scrolls: false }),
};

export function placeNoteEditor(scene: NoteEditorScene): NoteEditorPlacement {
	const { trigger } = scene;
	if (trigger.reason === "scroll") return KEPT_ON_SCROLL[trigger.mode](scene);
	return choose({ scene, scrolls: trigger.reason !== "resize" });
}
