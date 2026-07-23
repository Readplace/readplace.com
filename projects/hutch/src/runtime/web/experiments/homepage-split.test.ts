import assert from "node:assert/strict";
import {
	assignVariant,
	buildLandingUrl,
	campaignTag,
	formatStoredVariant,
	HOMEPAGE_SPLIT,
	parseStoredVariant,
	variantBySlug,
} from "./homepage-split";

const [VARIANT_A, VARIANT_B] = HOMEPAGE_SPLIT.variants;

describe("HOMEPAGE_SPLIT config", () => {
	it("declares two arms mapping variant-a/-b to /landing-a//landing-b", () => {
		expect(HOMEPAGE_SPLIT.variants.map((v) => v.slug)).toEqual(["variant-a", "variant-b"]);
		expect(HOMEPAGE_SPLIT.variants.map((v) => v.path)).toEqual(["/landing-a", "/landing-b"]);
		expect(HOMEPAGE_SPLIT.variants.map((v) => v.marker)).toEqual(["a", "b"]);
	});
});

describe("assignVariant", () => {
	it("buckets the low half of the byte range to the first arm", () => {
		expect(assignVariant(HOMEPAGE_SPLIT, 0)).toBe(VARIANT_A);
		expect(assignVariant(HOMEPAGE_SPLIT, 127)).toBe(VARIANT_A);
	});

	it("buckets the high half of the byte range to the second arm", () => {
		expect(assignVariant(HOMEPAGE_SPLIT, 128)).toBe(VARIANT_B);
		expect(assignVariant(HOMEPAGE_SPLIT, 255)).toBe(VARIANT_B);
	});
});

describe("campaignTag", () => {
	it("folds the epoch into the campaign so a re-bucket scopes the measurement window", () => {
		expect(campaignTag(HOMEPAGE_SPLIT)).toBe("homepage-split-e1");
		expect(campaignTag({ ...HOMEPAGE_SPLIT, epoch: 2 })).toBe("homepage-split-e2");
	});
});

describe("buildLandingUrl", () => {
	it("carries the epoch-tagged campaign, an experiment medium, and the variant slug (no utm_source)", () => {
		expect(buildLandingUrl(HOMEPAGE_SPLIT, VARIANT_A)).toBe(
			"/landing-a?utm_campaign=homepage-split-e1&utm_medium=experiment&utm_content=variant-a",
		);
		expect(buildLandingUrl(HOMEPAGE_SPLIT, VARIANT_B)).toBe(
			"/landing-b?utm_campaign=homepage-split-e1&utm_medium=experiment&utm_content=variant-b",
		);
	});
});

describe("variantBySlug", () => {
	it("resolves a known slug", () => {
		expect(variantBySlug(HOMEPAGE_SPLIT, "variant-a")).toBe(VARIANT_A);
		expect(variantBySlug(HOMEPAGE_SPLIT, "variant-b")).toBe(VARIANT_B);
	});

	it("returns undefined for an unknown slug", () => {
		expect(variantBySlug(HOMEPAGE_SPLIT, "variant-z")).toBeUndefined();
	});
});

describe("formatStoredVariant", () => {
	it("prefixes the current epoch to the slug", () => {
		expect(formatStoredVariant(HOMEPAGE_SPLIT, VARIANT_A)).toBe("1:variant-a");
	});
});

describe("parseStoredVariant", () => {
	it("returns undefined when nothing is stored", () => {
		expect(parseStoredVariant(HOMEPAGE_SPLIT, null)).toBeUndefined();
	});

	it("round-trips a current-epoch value back to its variant", () => {
		const stored = formatStoredVariant(HOMEPAGE_SPLIT, VARIANT_B);
		assert.equal(parseStoredVariant(HOMEPAGE_SPLIT, stored), VARIANT_B);
	});

	it("returns undefined for a stale epoch so the visitor is re-bucketed", () => {
		expect(parseStoredVariant(HOMEPAGE_SPLIT, "2:variant-a")).toBeUndefined();
	});

	it("returns undefined when the epoch matches but the slug is unknown", () => {
		expect(parseStoredVariant(HOMEPAGE_SPLIT, "1:variant-z")).toBeUndefined();
	});

	it("returns undefined for a malformed value with no separator", () => {
		expect(parseStoredVariant(HOMEPAGE_SPLIT, "garbage")).toBeUndefined();
	});
});
