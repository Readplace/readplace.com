import {
	HIGHLIGHT_FEATURE,
	highlightFeatureEnabled,
	highlightFeatureParams,
} from "./highlight-feature";

describe("highlightFeatureEnabled", () => {
	it("is on when the query names the highlight feature", () => {
		expect(highlightFeatureEnabled({ feature: HIGHLIGHT_FEATURE })).toBe(true);
	});

	it("is off without the feature param", () => {
		expect(highlightFeatureEnabled({})).toBe(false);
	});

	it("is off for another feature", () => {
		expect(highlightFeatureEnabled({ feature: "pref" })).toBe(false);
	});
});

describe("highlightFeatureParams", () => {
	it("carries the feature param when enabled", () => {
		expect(highlightFeatureParams(true)).toEqual([["feature", "highlight"]]);
	});

	it("carries nothing when disabled", () => {
		expect(highlightFeatureParams(false)).toEqual([]);
	});
});
