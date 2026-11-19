import { JSDOM } from "jsdom";
import {
	type ClearPlacement,
	type PassageRect,
	passageRectsOf,
	pickPassageMode,
	placeByMode,
	placeClearOfPassage,
	TOOLBAR_GAP_PX,
} from "./place-clear-of-passage";

const panel = { width: 100, height: 40 };
const unzoomed = { width: 400, height: 800, offsetLeft: 0, offsetTop: 0 };

function rect(params: { top: number; left: number; width: number; height?: number }): PassageRect {
	return { top: params.top, bottom: params.top + (params.height ?? 20), left: params.left, width: params.width };
}

function intersects(input: { placement: ClearPlacement; rects: readonly PassageRect[] }): boolean {
	const boxTop = Math.min(...input.rects.map((r) => r.top));
	const boxBottom = Math.max(...input.rects.map((r) => r.bottom));
	const boxLeft = Math.min(...input.rects.map((r) => r.left));
	const boxRight = Math.max(...input.rects.map((r) => r.left + r.width));
	const { top, left } = input.placement;
	return top < boxBottom && top + panel.height > boxTop && left < boxRight && left + panel.width > boxLeft;
}

describe("placeClearOfPassage", () => {
	const twoLines = [rect({ top: 300, left: 20, width: 300 }), rect({ top: 320, left: 50, width: 200 })];

	it("places the panel 10 px above the passage, centred on its first rect", () => {
		const placement = placeClearOfPassage({
			gap: TOOLBAR_GAP_PX,
			rects: twoLines,
			panel,
			viewport: unzoomed,
			order: ["above", "below"],
			whenNoneFits: "last-side",
		});

		expect(placement).toEqual({ top: 300 - 10 - 40, left: 20 + 150 - 50, side: "above", clear: true });
		expect(intersects({ placement, rects: twoLines })).toBe(false);
	});

	it("falls to below the passage, centred on its last rect, when above would cross the viewport's top", () => {
		const rects = [rect({ top: 20, left: 20, width: 300 }), rect({ top: 40, left: 50, width: 200 })];
		const placement = placeClearOfPassage({
			gap: TOOLBAR_GAP_PX,
			rects,
			panel,
			viewport: unzoomed,
			order: ["above", "below"],
			whenNoneFits: "last-side",
		});

		expect(placement).toEqual({ top: 60 + 10, left: 50 + 100 - 50, side: "below", clear: true });
		expect(intersects({ placement, rects })).toBe(false);
	});

	it("tries below first when the order says so", () => {
		const placement = placeClearOfPassage({
			gap: TOOLBAR_GAP_PX,
			rects: twoLines,
			panel,
			viewport: unzoomed,
			order: ["below", "above"],
			whenNoneFits: "last-side",
		});

		expect(placement).toEqual({ top: 340 + 10, left: 100, side: "below", clear: true });
		expect(intersects({ placement, rects: twoLines })).toBe(false);
	});

	it("measures the passage's box from its highest top and lowest bottom, whatever the rect order", () => {
		const rects = [rect({ top: 320, left: 50, width: 200 }), rect({ top: 300, left: 20, width: 300, height: 60 })];
		const above = placeClearOfPassage({
			gap: TOOLBAR_GAP_PX,
			rects,
			panel,
			viewport: unzoomed,
			order: ["above"],
			whenNoneFits: "last-side",
		});
		const below = placeClearOfPassage({
			gap: TOOLBAR_GAP_PX,
			rects,
			panel,
			viewport: unzoomed,
			order: ["below"],
			whenNoneFits: "last-side",
		});

		expect(above.top).toBe(300 - 10 - 40);
		expect(below.top).toBe(360 + 10);
		expect(intersects({ placement: above, rects })).toBe(false);
		expect(intersects({ placement: below, rects })).toBe(false);
	});

	it("keeps the caller's gap between the passage and the panel on either side", () => {
		const rects = [rect({ top: 300, left: 100, width: 200 })];
		const above = placeClearOfPassage({
			gap: 64,
			rects,
			panel,
			viewport: unzoomed,
			order: ["above"],
			whenNoneFits: "last-side",
		});
		const below = placeClearOfPassage({
			gap: 64,
			rects,
			panel,
			viewport: unzoomed,
			order: ["below"],
			whenNoneFits: "last-side",
		});

		expect(above.top).toBe(300 - 64 - 40);
		expect(below.top).toBe(320 + 64);
	});

	it("uses the last side without a check when no side fits and the caller asks for the last side", () => {
		const tall = [rect({ top: 20, left: 100, width: 200, height: 770 })];

		expect(
			placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects: tall,
				panel,
				viewport: unzoomed,
				order: ["above", "below"],
				whenNoneFits: "last-side",
			}),
		).toEqual({ top: 790 + 10, left: 150, side: "below", clear: true });
	});

	it("moves the panel 16 px inside the viewport's bottom when no side fits and the caller asks to stay in view", () => {
		const tall = [rect({ top: -200, left: 100, width: 200, height: 1200 })];

		expect(
			placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects: tall,
				panel,
				viewport: unzoomed,
				order: ["above", "below"],
				whenNoneFits: "inside-viewport",
			}),
		).toEqual({ top: 800 - 16 - 40, left: 150, side: "below", clear: false });
	});

	it("moves the panel 16 px inside the viewport's top when the last side sits above it", () => {
		const tall = [rect({ top: -200, left: 100, width: 200, height: 1200 })];

		expect(
			placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects: tall,
				panel,
				viewport: unzoomed,
				order: ["below", "above"],
				whenNoneFits: "inside-viewport",
			}),
		).toEqual({ top: 16, left: 150, side: "above", clear: false });
	});

	it("keeps the top of a panel taller than the viewport less both gutters at the top gutter", () => {
		const tall = [rect({ top: -200, left: 100, width: 200, height: 1200 })];

		expect(
			placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects: tall,
				panel: { width: 100, height: 790 },
				viewport: { ...unzoomed, offsetTop: 50 },
				order: ["above", "below"],
				whenNoneFits: "inside-viewport",
			}).top,
		).toBe(50 + 16);
	});

	it("clamps the left edge 16 px inside the visual viewport", () => {
		expect(
			placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects: [rect({ top: 300, left: 0, width: 20 })],
				panel,
				viewport: unzoomed,
				order: ["above"],
				whenNoneFits: "last-side",
			}).left,
		).toBe(16);
	});

	it("clamps the right edge 16 px inside the visual viewport", () => {
		expect(
			placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects: [rect({ top: 300, left: 380, width: 20 })],
				panel,
				viewport: unzoomed,
				order: ["below"],
				whenNoneFits: "last-side",
			}).left,
		).toBe(400 - 100 - 16);
	});

	it("pins a panel wider than the viewport less both gutters to the left gutter", () => {
		expect(
			placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects: [rect({ top: 300, left: 150, width: 100 })],
				panel: { width: 380, height: 40 },
				viewport: { ...unzoomed, offsetLeft: 30 },
				order: ["above"],
				whenNoneFits: "last-side",
			}).left,
		).toBe(30 + 16);
	});

	it("checks the sides against a pinch-zoomed visual viewport", () => {
		const zoomed = { width: 200, height: 400, offsetLeft: 200, offsetTop: 200 };
		const nearTop = [rect({ top: 230, left: 250, width: 100 })];
		const placement = placeClearOfPassage({
			gap: TOOLBAR_GAP_PX,
			rects: nearTop,
			panel,
			viewport: zoomed,
			order: ["above", "below"],
			whenNoneFits: "last-side",
		});

		expect(placement).toEqual({ top: 250 + 10, left: 250, side: "below", clear: true });
		expect(intersects({ placement, rects: nearTop })).toBe(false);
	});

	it("refuses a passage without client rects", () => {
		expect(() =>
			placeClearOfPassage({
				gap: TOOLBAR_GAP_PX,
				rects: [],
				panel,
				viewport: unzoomed,
				order: ["above"],
				whenNoneFits: "last-side",
			}),
		).toThrow("a selection holding text has client rects");
	});
});

describe("pickPassageMode", () => {
	it("picks above when the panel fits above the passage", () => {
		expect(pickPassageMode({ rects: [rect({ top: 300, left: 20, width: 100 })], panel, viewport: unzoomed })).toBe("above");
	});

	it("picks below when only below fits", () => {
		expect(pickPassageMode({ rects: [rect({ top: 20, left: 20, width: 100 })], panel, viewport: unzoomed })).toBe("below");
	});

	it("docks when neither side fits", () => {
		const tall = [rect({ top: 30, left: 20, width: 100, height: 740 })];
		expect(pickPassageMode({ rects: tall, panel, viewport: unzoomed })).toBe("docked");
	});
});

describe("placeByMode", () => {
	const zoomed = { width: 300, height: 500, offsetLeft: 40, offsetTop: 60 };

	it("places on the mode's side even when that side no longer fits", () => {
		const rects = [rect({ top: 20, left: 20, width: 100 })];
		expect(placeByMode({ mode: "above", dock: "gutter", rects, panel, viewport: unzoomed })).toEqual({
			top: 20 - 10 - 40,
			left: 20 + 50 - 50,
		});
	});

	it("docks at the bottom of the visual viewport against its left gutter", () => {
		expect(placeByMode({ mode: "docked", dock: "gutter", rects: [], panel, viewport: zoomed })).toEqual({
			top: 60 + 500 - 16 - 40,
			left: 40 + 16,
		});
	});

	it("docks at the bottom of the visual viewport, centred", () => {
		expect(placeByMode({ mode: "docked", dock: "centred", rects: [], panel, viewport: zoomed })).toEqual({
			top: 60 + 500 - 16 - 40,
			left: 40 + (300 - 100) / 2,
		});
	});
});

describe("passageRectsOf", () => {
	it("gathers the rects of every mark of the highlight and of no other", () => {
		const { document } = new JSDOM(
			'<p><mark class="article-highlight" data-highlight-id="a">one</mark> <mark class="article-highlight" data-highlight-id="b">two</mark> <mark class="article-highlight" data-highlight-id="a">three</mark></p>',
		).window;
		const measured: string[] = [];
		const rects = passageRectsOf({
			document,
			id: "a",
			rectsOf: (range) => {
				measured.push(range.toString());
				return [rect({ top: measured.length * 100, left: 0, width: 10 })];
			},
		});

		expect(measured).toEqual(["one", "three"]);
		expect(rects.map((r) => r.top)).toEqual([100, 200]);
	});
});
