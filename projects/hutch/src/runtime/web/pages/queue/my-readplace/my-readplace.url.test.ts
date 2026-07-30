import {
	buildMyReadplaceCountsUrl,
	buildMyReadplaceSaveUrl,
	buildMyReadplaceUrl,
	parseMyReadplaceState,
} from "./my-readplace.url";

describe("parseMyReadplaceState", () => {
	it("should default to the plain summary/compose state", () => {
		expect(parseMyReadplaceState({ tab: "my", feature: "my" })).toEqual({
			edit: false,
			invalid: false,
		});
	});

	it("should read the edit flag off the query", () => {
		expect(parseMyReadplaceState({ tab: "my", feature: "my", edit: "1" })).toEqual({
			edit: true,
			invalid: false,
		});
	});

	it("should read both flags when a rejected save returns to the form", () => {
		expect(
			parseMyReadplaceState({ tab: "my", feature: "my", edit: "1", invalid: "1" }),
		).toEqual({ edit: true, invalid: true });
	});

	it("should treat any value other than 1 as unset", () => {
		expect(parseMyReadplaceState({ edit: "yes", invalid: "0" })).toEqual({
			edit: false,
			invalid: false,
		});
	});
});

describe("buildMyReadplaceUrl", () => {
	it("should carry both the tab and the feature flag so the tab survives navigation", () => {
		expect(buildMyReadplaceUrl()).toBe("/queue?tab=my&feature=my");
	});

	it("should add the edit flag for the edit state", () => {
		expect(buildMyReadplaceUrl({ edit: true })).toBe("/queue?tab=my&feature=my&edit=1");
	});

	it("should add both flags when a rejected save returns to the form", () => {
		expect(buildMyReadplaceUrl({ edit: true, invalid: true })).toBe(
			"/queue?tab=my&feature=my&edit=1&invalid=1",
		);
	});
});

describe("buildMyReadplaceCountsUrl", () => {
	it("should request counts for the My Readplace tab", () => {
		expect(buildMyReadplaceCountsUrl()).toBe("/queue/counts?tab=my&feature=my");
	});
});

describe("buildMyReadplaceSaveUrl", () => {
	it("should carry the feature flag so the POST handler still sees the tab enabled", () => {
		expect(buildMyReadplaceSaveUrl()).toBe("/queue/my-readplace?feature=my");
	});
});
