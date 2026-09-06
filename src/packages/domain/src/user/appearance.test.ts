import { APPEARANCE_PREFERENCES, AppearancePreferenceSchema } from "./appearance";

describe("appearance preference", () => {
	it("lists the preferences with the default (system) first", () => {
		expect(APPEARANCE_PREFERENCES).toEqual(["system", "light", "dark"]);
	});

	it("parses a supported preference", () => {
		expect(AppearancePreferenceSchema.parse("dark")).toBe("dark");
	});
});
