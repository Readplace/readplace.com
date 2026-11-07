import { placeBelowSelection } from "./toolbar-placement-coarse";

const toolbar = { width: 100, height: 40 };
const unzoomed = { width: 400, height: 800, offsetLeft: 0, offsetTop: 0 };

function rect(params: { top: number; left: number; width: number; height?: number }) {
	const height = params.height ?? 20;
	return {
		top: params.top,
		bottom: params.top + height,
		left: params.left,
		width: params.width,
	};
}

describe("placeBelowSelection", () => {
	it("places the bar 10 px below the last rect, centred on it", () => {
		const position = placeBelowSelection({
			rects: [rect({ top: 100, left: 20, width: 300 }), rect({ top: 120, left: 50, width: 200 })],
			toolbar,
			viewport: unzoomed,
		});

		expect(position).toEqual({ top: 150, left: 100 });
	});

	it("flips above the first rect when the bar would cross the visual viewport's bottom", () => {
		const position = placeBelowSelection({
			rects: [rect({ top: 720, left: 100, width: 200 }), rect({ top: 745, left: 20, width: 100 })],
			toolbar,
			viewport: unzoomed,
		});

		expect(position).toEqual({ top: 720 - 10 - 40, left: 150 });
	});

	it("clamps the left edge 16 px inside the visual viewport", () => {
		const position = placeBelowSelection({
			rects: [rect({ top: 100, left: 0, width: 20 })],
			toolbar,
			viewport: unzoomed,
		});

		expect(position.left).toBe(16);
	});

	it("clamps the right edge 16 px inside the visual viewport", () => {
		const position = placeBelowSelection({
			rects: [rect({ top: 100, left: 380, width: 20 })],
			toolbar,
			viewport: unzoomed,
		});

		expect(position.left).toBe(400 - 100 - 16);
	});

	it("pins a bar wider than the viewport less both gutters to the left gutter", () => {
		const position = placeBelowSelection({
			rects: [rect({ top: 100, left: 150, width: 100 })],
			toolbar: { width: 380, height: 40 },
			viewport: { width: 400, height: 800, offsetLeft: 30, offsetTop: 0 },
		});

		expect(position.left).toBe(30 + 16);
	});

	it("places a mid-screen rect in a zoomed viewport where it would sit unzoomed", () => {
		const selection = [rect({ top: 400, left: 250, width: 100 })];
		const zoomed = { width: 200, height: 400, offsetLeft: 200, offsetTop: 200 };

		expect(placeBelowSelection({ rects: selection, toolbar, viewport: zoomed })).toEqual(
			placeBelowSelection({ rects: selection, toolbar, viewport: unzoomed }),
		);
		expect(placeBelowSelection({ rects: selection, toolbar, viewport: zoomed })).toEqual({ top: 430, left: 250 });
	});

	it("flips a rect near the bottom of a zoomed viewport", () => {
		const position = placeBelowSelection({
			rects: [rect({ top: 570, left: 250, width: 100 })],
			toolbar,
			viewport: { width: 200, height: 400, offsetLeft: 200, offsetTop: 200 },
		});

		expect(position).toEqual({ top: 570 - 10 - 40, left: 250 });
	});

	it("refuses a selection without client rects", () => {
		expect(() => placeBelowSelection({ rects: [], toolbar, viewport: unzoomed })).toThrow(
			"a selection holding text has client rects",
		);
	});
});
