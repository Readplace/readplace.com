import * as thresholds from "./section-thresholds";

describe("section thresholds", () => {
	it("pins the values the three real captures were calibrated against", () => {
		expect({ ...thresholds }).toEqual({
			MIN_UNITS: 3,
			LEAD_WORDS: 8,
			DOMINANT_UNIT_SHARE: 0.8,
			DESCEND_MIN_SHARE: 0.5,
			MEDIAN_UNIT_WORDS: 40,
			OUTSIDE_PROSE_WORDS: 40,
			ITEM_MIN_WORDS: 3,
			ITEM_MAX_WORDS: 80,
			REPEATED_ITEMS: 3,
			WORD_WINDOW: 8,
			CJK_WINDOW: 12,
			MIN_RUN_TOKENS: 2,
			ASSOCIATION_MAX_TOKENS: 12,
		});
	});
});
