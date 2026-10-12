export type HomepageVariantMarker = "a" | "b";

export interface HomepageSplitVariant {
	readonly slug: string;
	readonly marker: HomepageVariantMarker;
}

export interface HomepageSplitConfig {
	readonly active: boolean;
	readonly campaign: string;
	readonly epoch: number;
	readonly variants: readonly [HomepageSplitVariant, HomepageSplitVariant];
}

export const HOMEPAGE_SPLIT: HomepageSplitConfig = {
	active: true,
	campaign: "homepage-ai-cost",
	epoch: 1,
	variants: [
		{ slug: "variant-c", marker: "a" },
		{ slug: "variant-d", marker: "b" },
	],
};

export function assignVariant(config: HomepageSplitConfig, randomByte: number): HomepageSplitVariant {
	return randomByte < 128 ? config.variants[0] : config.variants[1];
}

export function campaignTag(config: HomepageSplitConfig): string {
	return `${config.campaign}-e${config.epoch}`;
}

export function variantBySlug(config: HomepageSplitConfig, slug: string): HomepageSplitVariant | undefined {
	return config.variants.find((variant) => variant.slug === slug);
}
