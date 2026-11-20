import { TOOLBAR_GAP_PX, VIEWPORT_GUTTER_PX } from "./place-clear-of-passage";
import {
	NOTE_EDITOR_MIN_WIDTH_PX,
	placeNoteEditor,
	SHEET_MAX_VIEWPORT_FRACTION,
} from "./place-note-editor";

const DESKTOP = { width: 1280, height: 900, offsetLeft: 0, offsetTop: 0 };
const NARROW_COLUMN = { left: 340, width: 600 };
const WEB_READER_INSET = 52;
const APP_READER_INSET = 64;

const desktopScene = {
	editor: { width: 600, height: 240 },
	viewport: DESKTOP,
	topInset: WEB_READER_INSET,
	column: NARROW_COLUMN,
	chrome: [],
};

const RAIL = { top: 52, bottom: 900, left: 900, width: 340 };
const railScene = {
	viewport: DESKTOP,
	topInset: WEB_READER_INSET,
	column: { left: 40, width: 600 },
	chrome: [RAIL],
};

const marginScene = {
	editor: { width: 600, height: 400 },
	viewport: DESKTOP,
	topInset: WEB_READER_INSET,
	column: { left: 440, width: 600 },
	chrome: [],
};

const centredPassage = [
	{ top: 300, bottom: 324, left: 460, width: 560 },
	{ top: 576, bottom: 600, left: 460, width: 300 },
];

describe("placeNoteEditor", () => {
	it("names the editor's minimum width and the sheet's cap", () => {
		expect({ NOTE_EDITOR_MIN_WIDTH_PX, SHEET_MAX_VIEWPORT_FRACTION }).toEqual({
			NOTE_EDITOR_MIN_WIDTH_PX: 320,
			SHEET_MAX_VIEWPORT_FRACTION: 0.5,
		});
	});

	it("places the editor above the passage when it fits there", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 400, bottom: 424, left: 400, width: 500 }],
				trigger: { reason: "open" },
			}),
		).toEqual({
			mode: "above",
			top: 150,
			left: 350,
			width: 600,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy: 0,
		});
	});

	it("reads a passage rect's edges through its getters, as a DOMRect holds them", () => {
		class ClientRect {
			get top() {
				return 400;
			}
			get bottom() {
				return 424;
			}
			get left() {
				return 400;
			}
			get width() {
				return 500;
			}
		}

		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [new ClientRect()],
				trigger: { reason: "open" },
			}),
		).toMatchObject({ mode: "above", top: 150, left: 350 });
	});

	it("places the editor below the passage when above does not fit", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 200, bottom: 224, left: 400, width: 500 }],
				trigger: { reason: "open" },
			}),
		).toEqual({
			mode: "below",
			top: 234,
			left: 350,
			width: 600,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy: 0,
		});
	});

	it("places the editor below when only the chrome's edge blocks the space above", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 290, bottom: 314, left: 400, width: 500 }],
				trigger: { reason: "open" },
			}).mode,
		).toBe("below");
	});

	it("scrolls a first line hidden under the web reader's banner to just under it, and places the editor below", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				topInset: WEB_READER_INSET,
				rects: [
					{ top: 40, bottom: 64, left: 400, width: 500 },
					{ top: 64, bottom: 88, left: 400, width: 300 },
				],
				trigger: { reason: "open" },
			}),
		).toEqual({
			mode: "below",
			top: 110,
			left: 250,
			width: 600,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy: -12,
		});
	});

	it("scrolls a first line hidden under the in-app reader's toolbar to just under it, and places the editor below", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				topInset: APP_READER_INSET,
				rects: [
					{ top: 40, bottom: 64, left: 400, width: 500 },
					{ top: 64, bottom: 88, left: 400, width: 300 },
				],
				trigger: { reason: "open" },
			}),
		).toEqual({
			mode: "below",
			top: 122,
			left: 250,
			width: 600,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy: -24,
		});
	});

	it("docks a sheet above the keyboard and scrolls a passage that fits wholly between the visible top and the sheet", () => {
		expect(
			placeNoteEditor({
				editor: { width: 380, height: 300 },
				viewport: { width: 412, height: 500, offsetLeft: 0, offsetTop: 300 },
				topInset: WEB_READER_INSET,
				column: { left: 16, width: 380 },
				chrome: [],
				rects: [
					{ top: 600, bottom: 620, left: 16, width: 380 },
					{ top: 780, bottom: 800, left: 16, width: 200 },
				],
				trigger: { reason: "keyboard" },
			}),
		).toEqual({
			mode: "sheet",
			top: 534,
			left: 16,
			width: 380,
			maxHeight: 250,
			bottomSpace: 266,
			scrollBy: 276,
		});
	});

	it("places the editor in a free margin when neither above nor below fits", () => {
		expect(
			placeNoteEditor({
				...marginScene,
				rects: centredPassage,
				trigger: { reason: "open" },
			}),
		).toEqual({
			mode: "beside",
			top: 300,
			left: 16,
			width: 408,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy: 0,
		});
	});

	it("leaves a margin that holds the rail and docks a sheet, scrolling the passage wholly above it", () => {
		expect(
			placeNoteEditor({
				...railScene,
				editor: { width: 600, height: 400 },
				rects: [
					{ top: 300, bottom: 324, left: 60, width: 560 },
					{ top: 576, bottom: 600, left: 60, width: 300 },
				],
				trigger: { reason: "open" },
			}),
		).toEqual({
			mode: "sheet",
			top: 484,
			left: 340,
			width: 600,
			maxHeight: 450,
			bottomSpace: 416,
			scrollBy: 126,
		});
	});

	it("leaves a margin that holds chrome on the left of the column", () => {
		expect(
			placeNoteEditor({
				...marginScene,
				chrome: [{ top: 52, bottom: 900, left: 0, width: 200 }],
				rects: centredPassage,
				trigger: { reason: "open" },
			}).mode,
		).toBe("sheet");
	});

	it("brings only the first line of a passage taller than the space above the sheet into that space", () => {
		expect(
			placeNoteEditor({
				...railScene,
				editor: { width: 600, height: 460 },
				rects: [
					{ top: 500, bottom: 524, left: 60, width: 560 },
					{ top: 1056, bottom: 1080, left: 60, width: 300 },
				],
				trigger: { reason: "open" },
			}),
		).toEqual({
			mode: "sheet",
			top: 434,
			left: 340,
			width: 600,
			maxHeight: 450,
			bottomSpace: 466,
			scrollBy: 100,
		});
	});

	it("keeps the mode on a scroll and never scrolls, even when another mode would now fit", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 400, bottom: 424, left: 400, width: 500 }],
				trigger: { reason: "scroll", mode: "below" },
			}),
		).toEqual({
			mode: "below",
			top: 434,
			left: 350,
			width: 600,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy: 0,
		});
	});

	it("keeps a sheet docked on a scroll", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 400, bottom: 424, left: 400, width: 500 }],
				trigger: { reason: "scroll", mode: "sheet" },
			}),
		).toEqual({
			mode: "sheet",
			top: 644,
			left: 340,
			width: 600,
			maxHeight: 450,
			bottomSpace: 256,
			scrollBy: 0,
		});
	});

	it("follows the passage in the margin on a scroll, held inside the visible area", () => {
		expect(
			placeNoteEditor({
				...marginScene,
				rects: [{ top: 20, bottom: 44, left: 460, width: 560 }],
				trigger: { reason: "scroll", mode: "beside" },
			}),
		).toEqual({
			mode: "beside",
			top: 68,
			left: 16,
			width: 408,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy: 0,
		});
	});

	it("re-chooses without scrolling when a scroll finds the margin gone", () => {
		expect(
			placeNoteEditor({
				...marginScene,
				column: NARROW_COLUMN,
				rects: centredPassage,
				trigger: { reason: "scroll", mode: "beside" },
			}),
		).toEqual({
			mode: "sheet",
			top: 484,
			left: 340,
			width: 600,
			maxHeight: 450,
			bottomSpace: 416,
			scrollBy: 0,
		});
	});

	it("holds the editor inside the visible area while that still misses the passage", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 1200, bottom: 1224, left: 400, width: 500 }],
				trigger: { reason: "scroll", mode: "above" },
			}).top,
		).toBe(644);
	});

	it("stops holding the editor inside the visible area when the held position would meet the passage", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 270, bottom: 290, left: 400, width: 500 }],
				trigger: { reason: "scroll", mode: "above" },
			}).top,
		).toBe(20);
	});

	it("re-chooses the mode on an address-bar resize without scrolling, while the keyboard brings the first line back", () => {
		const scrolledAway = [{ top: 20, bottom: 44, left: 400, width: 500 }];

		const resized = placeNoteEditor({
			...desktopScene,
			rects: scrolledAway,
			trigger: { reason: "resize" },
		});
		const keyboard = placeNoteEditor({
			...desktopScene,
			rects: scrolledAway,
			trigger: { reason: "keyboard" },
		});

		expect({ resized, keyboard }).toEqual({
			resized: {
				mode: "below",
				top: 54,
				left: 350,
				width: 600,
				maxHeight: undefined,
				bottomSpace: 0,
				scrollBy: 0,
			},
			keyboard: {
				mode: "below",
				top: 86,
				left: 350,
				width: 600,
				maxHeight: undefined,
				bottomSpace: 0,
				scrollBy: -32,
			},
		});
	});

	it("scrolls nothing when the passage's first line is already in view", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 600, bottom: 624, left: 400, width: 500 }],
				trigger: { reason: "open" },
			}).scrollBy,
		).toBe(0);
	});

	it("scrolls a first line below the visible area just into view before choosing above", () => {
		expect(
			placeNoteEditor({
				...desktopScene,
				rects: [{ top: 1000, bottom: 1024, left: 400, width: 500 }],
				trigger: { reason: "open" },
			}),
		).toEqual({
			mode: "above",
			top: 626,
			left: 350,
			width: 600,
			maxHeight: undefined,
			bottomSpace: 0,
			scrollBy: 124,
		});
	});

	describe("never covers a passage it could keep clear of", () => {
		const scenes = [
			{
				name: "1280x900 with the rail",
				viewport: DESKTOP,
				topInset: WEB_READER_INSET,
				column: { left: 300, width: 600 },
				chrome: [{ top: 52, bottom: 900, left: 940, width: 340 }],
			},
			{
				name: "768x1024",
				viewport: { width: 768, height: 1024, offsetLeft: 0, offsetTop: 0 },
				topInset: WEB_READER_INSET,
				column: { left: 44, width: 680 },
				chrome: [],
			},
			{
				name: "412x915",
				viewport: { width: 412, height: 915, offsetLeft: 0, offsetTop: 0 },
				topInset: APP_READER_INSET,
				column: { left: 16, width: 380 },
				chrome: [],
			},
			{
				name: "412x400",
				viewport: { width: 412, height: 400, offsetLeft: 0, offsetTop: 0 },
				topInset: WEB_READER_INSET,
				column: { left: 16, width: 380 },
				chrome: [],
			},
			{
				name: "412x915 with the keyboard",
				viewport: { width: 412, height: 500, offsetLeft: 0, offsetTop: 300 },
				topInset: WEB_READER_INSET,
				column: { left: 16, width: 380 },
				chrome: [],
			},
		];
		const tops = [-600, -100, 0, 40, 150, 300, 450, 700, 900, 1300];
		const heights = [24, 120, 300, 800];
		const reasons = ["open", "keyboard"] as const;

		const cases = scenes.flatMap((scene) =>
			tops.flatMap((top) =>
				heights.flatMap((height) =>
					reasons.map((reason) => ({ scene, top, height, reason })),
				),
			),
		);

		it.each(cases)("$scene.name, passage at $top tall $height, on $reason", ({
			scene,
			top,
			height,
			reason,
		}) => {
			const { column, viewport, topInset } = scene;
			const firstLine = {
				top,
				bottom: top + 24,
				left: column.left,
				width: column.width,
			};
			const rects =
				height === 24
					? [firstLine]
					: [
							firstLine,
							{
								top: top + height - 24,
								bottom: top + height,
								left: column.left,
								width: column.width / 2,
							},
						];
			const editor = { width: Math.min(600, viewport.width - 32), height: 260 };

			const placement = placeNoteEditor({
				...scene,
				editor,
				rects,
				trigger: { reason },
			});

			const moved = {
				top: top - placement.scrollBy,
				bottom: top + height - placement.scrollBy,
			};
			const firstLineAfter = { top: moved.top, bottom: moved.top + 24 };
			const editorHeight =
				placement.maxHeight === undefined
					? editor.height
					: Math.min(editor.height, placement.maxHeight);
			const editorBox = {
				top: placement.top,
				bottom: placement.top + editorHeight,
			};
			const columnRight = column.left + column.width;
			const meetsVertically =
				editorBox.top < moved.bottom && editorBox.bottom > moved.top;
			const meetsHorizontally =
				placement.left < columnRight &&
				placement.left + placement.width > column.left;
			const visibleTop = Math.max(viewport.offsetTop, topInset);
			const visibleBottom = viewport.offsetTop + viewport.height;

			if (meetsVertically && meetsHorizontally) {
				expect({
					mode: placement.mode,
					tallerThanSpace: height > placement.top - TOOLBAR_GAP_PX - visibleTop,
					firstLineAboveSheet:
						firstLineAfter.top >= visibleTop &&
						firstLineAfter.bottom <= placement.top,
					bottomSpace: placement.bottomSpace,
				}).toEqual({
					mode: "sheet",
					tallerThanSpace: true,
					firstLineAboveSheet: true,
					bottomSpace: editorHeight + VIEWPORT_GUTTER_PX,
				});
			} else {
				expect(
					firstLineAfter.top >= visibleTop &&
						firstLineAfter.bottom <= visibleBottom,
				).toBe(true);
			}
		});
	});
});
