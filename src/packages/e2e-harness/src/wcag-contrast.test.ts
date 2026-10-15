import assert from "node:assert/strict";
import { LENSES, NON_TEXT_MINIMUM, contrastRatio, textMinimum } from "./wcag-contrast";

const BLACK = { red: 0, green: 0, blue: 0 };
const WHITE = { red: 255, green: 255, blue: 255 };

describe("contrastRatio", () => {
	it("measures black on white at the 21:1 ceiling", () => {
		expect(contrastRatio({ ink: BLACK, surface: WHITE })).toBeCloseTo(21, 10);
	});

	it("measures the same ratio whichever colour is the ink", () => {
		expect(contrastRatio({ ink: WHITE, surface: BLACK })).toBeCloseTo(21, 10);
	});

	it("measures a colour against itself at 1:1", () => {
		const amber = { red: 173, green: 98, blue: 37 };
		expect(contrastRatio({ ink: amber, surface: amber })).toBe(1);
	});
});

describe("textMinimum", () => {
	it("asks 3:1 of 24px text at any weight", () => {
		assert.equal(textMinimum({ fontSizePx: 24, fontWeight: 400 }), 3);
	});

	it("asks 3:1 of bold text from 18.66px", () => {
		assert.equal(textMinimum({ fontSizePx: 18.66, fontWeight: 700 }), 3);
	});

	it("asks 4.5:1 of 18.66px text that is not bold", () => {
		assert.equal(textMinimum({ fontSizePx: 18.66, fontWeight: 600 }), 4.5);
	});

	it("asks 4.5:1 of body text", () => {
		assert.equal(textMinimum({ fontSizePx: 14, fontWeight: 400 }), 4.5);
	});
});

describe("NON_TEXT_MINIMUM", () => {
	it("asks 3:1 of a glyph or a border", () => {
		assert.equal(NON_TEXT_MINIMUM, 3);
	});
});

describe("LENSES", () => {
	it("drops hue under the greyscale lens, leaving equal channels", () => {
		const grey = LENSES.greyscale({ red: 200, green: 100, blue: 50 });
		assert.equal(grey.red, grey.green);
		assert.equal(grey.green, grey.blue);
		expect(grey.red).toBeCloseTo(117.65, 10);
	});

	it("passes a colour through unchanged under the colour lens", () => {
		const amber = { red: 173, green: 98, blue: 37 };
		assert.deepEqual(LENSES.colour(amber), amber);
	});
});
