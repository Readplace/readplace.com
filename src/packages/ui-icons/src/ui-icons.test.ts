import { findIconSvg, iconSvg } from "./ui-icons";

describe("findIconSvg", () => {
	it("resolves a known name to the same markup as the typed call", () => {
		expect(findIconSvg("arrow-right")).toBe(iconSvg("arrow-right"));
	});

	it("draws the pencil the queue rail names its rename affordance with", () => {
		expect(findIconSvg("pencil")).toBe(iconSvg("pencil"));
	});

	it("resolves the trash icon the queue rail names its delete affordance with", () => {
		expect(findIconSvg("trash")).toBe(iconSvg("trash"));
	});

	it("resolves the ellipsis icons a row menu names its overflow affordance with", () => {
		expect(findIconSvg("ellipsis")).toBe(iconSvg("ellipsis"));
		expect(findIconSvg("ellipsis-vertical")).toBe(iconSvg("ellipsis-vertical"));
	});

	it("reports an unknown name rather than drawing nothing, so a caller can fail a typo", () => {
		expect(findIconSvg("fa-solid fa-inbox")).toBeUndefined();
	});
});
