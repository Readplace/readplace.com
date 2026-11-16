import { dockToViewportBottom } from "./toolbar-placement-coarse";

const toolbar = { width: 100, height: 40 };
const unzoomed = { width: 400, height: 800, offsetLeft: 0, offsetTop: 0 };

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
