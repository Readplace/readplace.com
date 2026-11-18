import { dockToViewportBottom, placeNearSelection, SYSTEM_MENU_CLEARANCE_PX } from "./toolbar-placement-coarse";

const toolbar = { width: 100, height: 40 };
const unzoomed = { width: 400, height: 800, offsetLeft: 0, offsetTop: 0 };

function line(params: { top: number; left?: number; width?: number }) {
	return {
		top: params.top,
		bottom: params.top + 20,
		left: params.left ?? 100,
		width: params.width ?? 200,
	};
}

describe("placeNearSelection", () => {
	it("sits the system menu's height below the selection, centred on its last line", () => {
		const position = placeNearSelection({
			rects: [line({ top: 280, left: 0, width: 400 }), line({ top: 300 })],
			toolbar,
			viewport: unzoomed,
			floorTop: undefined,
		});

		expect(SYSTEM_MENU_CLEARANCE_PX).toBe(64);
		expect(position).toEqual({ top: 320 + 64, left: 150 });
	});

	it("moves above the selection, the system menu's height away, when there is no room below", () => {
		const position = placeNearSelection({
			rects: [line({ top: 700 })],
			toolbar,
			viewport: unzoomed,
			floorTop: undefined,
		});

		expect(position).toEqual({ top: 700 - 64 - 40, left: 150 });
	});

	it("docks to the bottom when the selection leaves no room above or below", () => {
		const position = placeNearSelection({
			rects: [{ top: 50, bottom: 760, left: 0, width: 400 }],
			toolbar,
			viewport: unzoomed,
			floorTop: undefined,
		});

		expect(position).toEqual({ top: 800 - 16 - 40, left: 150 });
	});

	it("docks to the bottom when the selection reports no rects", () => {
		const position = placeNearSelection({
			rects: [],
			toolbar,
			viewport: unzoomed,
			floorTop: undefined,
		});

		expect(position).toEqual({ top: 800 - 16 - 40, left: 150 });
	});

	it("moves above the selection when the slot below would cross a bottom bar inside the viewport", () => {
		const position = placeNearSelection({
			rects: [line({ top: 560 })],
			toolbar,
			viewport: unzoomed,
			floorTop: 650,
		});

		expect(position.top).toBe(560 - 64 - 40);
	});

	it("ignores a bottom bar below the visual viewport when measuring the room below", () => {
		const position = placeNearSelection({
			rects: [line({ top: 560 })],
			toolbar,
			viewport: unzoomed,
			floorTop: 900,
		});

		expect(position.top).toBe(580 + 64);
	});

	it("keeps the bar inside the left gutter for a selection at the screen's edge", () => {
		const position = placeNearSelection({
			rects: [line({ top: 300, left: 0, width: 40 })],
			toolbar,
			viewport: unzoomed,
			floorTop: undefined,
		});

		expect(position.left).toBe(16);
	});
});

describe("dockToViewportBottom", () => {
	it("docks the bar 16 px above the visual viewport's bottom, centred", () => {
		const position = dockToViewportBottom({ toolbar, viewport: unzoomed, floorTop: undefined });

		expect(position).toEqual({ top: 800 - 16 - 40, left: 150 });
	});

	it("pins a bar wider than the viewport less both gutters to the left gutter", () => {
		const position = dockToViewportBottom({
			toolbar: { width: 380, height: 40 },
			viewport: { width: 400, height: 800, offsetLeft: 30, offsetTop: 0 },
			floorTop: undefined,
		});

		expect(position.left).toBe(30 + 16);
	});

	it("docks to the bottom and centre of a zoomed viewport", () => {
		const position = dockToViewportBottom({
			toolbar,
			viewport: { width: 200, height: 400, offsetLeft: 200, offsetTop: 200 },
			floorTop: undefined,
		});

		expect(position).toEqual({ top: 600 - 16 - 40, left: 250 });
	});

	it("docks 16 px above a bottom bar whose top is inside the visual viewport", () => {
		const position = dockToViewportBottom({ toolbar, viewport: unzoomed, floorTop: 700 });

		expect(position).toEqual({ top: 700 - 16 - 40, left: 150 });
	});

	it("ignores a bottom bar below the visual viewport's bottom", () => {
		const position = dockToViewportBottom({
			toolbar,
			viewport: { width: 200, height: 400, offsetLeft: 0, offsetTop: 0 },
			floorTop: 700,
		});

		expect(position.top).toBe(400 - 16 - 40);
	});

	it("ignores a bottom bar at or above the visual viewport's top, as a hidden element measures", () => {
		const position = dockToViewportBottom({ toolbar, viewport: unzoomed, floorTop: 0 });

		expect(position.top).toBe(800 - 16 - 40);
	});
});
