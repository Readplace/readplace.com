import assert from "node:assert/strict";
import {
	GENERATED_CONTENT_OUTSIDE_A_REQUEST,
	generatedContentAccessFor,
	parseStorefrontCountryCode,
	type StorefrontCountryCode,
} from "./generated-content";

function storefront(raw: string): StorefrontCountryCode {
	const parsed = parseStorefrontCountryCode(raw);
	assert(parsed, `${raw} must parse as a storefront country code`);
	return parsed;
}

describe("generatedContentAccessFor", () => {
	it.each([
		{ name: "a CN viewer country alone", viewerCountry: "CN", storefront: undefined },
		{ name: "a CHN storefront alone", viewerCountry: undefined, storefront: "CHN" },
		{ name: "a CN viewer country with a USA storefront", viewerCountry: "CN", storefront: "USA" },
		{ name: "a US viewer country with a CHN storefront", viewerCountry: "US", storefront: "CHN" },
	])("withholds generated content for $name", (signals) => {
		expect(
			generatedContentAccessFor({
				viewerCountry: signals.viewerCountry,
				storefront: signals.storefront === undefined ? undefined : storefront(signals.storefront),
			}),
		).toBe("withheld");
	});

	it.each(["HK", "MO", "TW"])("shows generated content to viewer country %s", (viewerCountry) => {
		expect(generatedContentAccessFor({ viewerCountry, storefront: undefined })).toBe("shown");
	});

	it.each(["HKG", "MAC", "TWN"])("shows generated content to storefront %s", (code) => {
		expect(generatedContentAccessFor({ viewerCountry: undefined, storefront: storefront(code) })).toBe("shown");
	});

	it("shows generated content when there is no signal at all", () => {
		expect(generatedContentAccessFor({ viewerCountry: undefined, storefront: undefined })).toBe("shown");
	});
});

describe("GENERATED_CONTENT_OUTSIDE_A_REQUEST", () => {
	it("shows generated content", () => {
		expect(GENERATED_CONTENT_OUTSIDE_A_REQUEST).toBe("shown");
	});
});

describe("parseStorefrontCountryCode", () => {
	it("accepts an ISO 3166-1 alpha-3 code", () => {
		expect(parseStorefrontCountryCode("CHN")).toBe("CHN");
	});

	it.each([
		{ name: "a lower-case code", raw: "chn" },
		{ name: "an alpha-2 code", raw: "CN" },
		{ name: "a country name", raw: "CHINA" },
		{ name: "an empty string", raw: "" },
		{ name: "a number", raw: 156 },
		{ name: "undefined", raw: undefined },
		{ name: "null", raw: null },
	])("rejects $name", ({ raw }) => {
		expect(parseStorefrontCountryCode(raw)).toBeUndefined();
	});
});
