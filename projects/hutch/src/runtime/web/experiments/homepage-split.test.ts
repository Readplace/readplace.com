import { assignVariant, campaignTag, HOMEPAGE_SPLIT, variantBySlug } from "./homepage-split";

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
		expect(campaignTag(HOMEPAGE_SPLIT)).toBe("homepage-split-e3");
		expect(campaignTag({ ...HOMEPAGE_SPLIT, epoch: 4 })).toBe("homepage-split-e4");
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
