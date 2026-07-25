import { findIconSvg, iconSvg } from "./ui-icons";

describe("findIconSvg", () => {
	it("resolves a known name to the same markup as the typed call", () => {
		expect(findIconSvg("arrow-right")).toBe(iconSvg("arrow-right"));
	});

	it("reports an unknown name rather than drawing nothing, so a caller can fail a typo", () => {
		expect(findIconSvg("fa-solid fa-inbox")).toBeUndefined();
	});
});
