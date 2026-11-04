export type HomepageVariantMarker = "b" | "c";

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
	epoch: 2,
	variants: [
		{ slug: "variant-e", marker: "b" },
		{ slug: "variant-f", marker: "c" },
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
