import type { Request } from "express";
import { QuerystringFeatureToggle } from "./feature-toggle";

function requestWithQuery(query: Record<string, unknown>): Request {
	return { query } as unknown as Request;
}

describe("QuerystringFeatureToggle", () => {
	it("returns true when ?feature=<name> matches the queried feature", () => {
		const toggle = new QuerystringFeatureToggle();

		expect(toggle.isEnabled(requestWithQuery({ feature: "audio" }), "audio")).toBe(true);
	});

	it("returns false when ?feature=<name> names a different feature", () => {
		const toggle = new QuerystringFeatureToggle();

		expect(toggle.isEnabled(requestWithQuery({ feature: "import" }), "audio")).toBe(false);
	});

	it("returns false when the request has no feature query param", () => {
		const toggle = new QuerystringFeatureToggle();

		expect(toggle.isEnabled(requestWithQuery({}), "audio")).toBe(false);
	});

	it("returns false when feature is provided as an array (?feature=a&feature=b)", () => {
		const toggle = new QuerystringFeatureToggle();

		expect(toggle.isEnabled(requestWithQuery({ feature: ["audio", "import"] }), "audio")).toBe(false);
	});
});
