import { railLandmarkFor } from "./rail-landmark";

describe("railLandmarkFor", () => {
	it("names a rail that shows a card as the Article details landmark", () => {
		expect(railLandmarkFor({ hasCard: true })).toEqual({
			tag: "aside",
			attributes: [{ name: "aria-label", value: "Article details" }],
		});
	});

	it("leaves a rail with no card as an unnamed div, so it adds no empty landmark", () => {
		expect(railLandmarkFor({ hasCard: false })).toEqual({ tag: "div", attributes: [] });
	});
});
