/**
 * Single source of truth for the homepage A/B split experiment.
 *
 * Kill switches: flip `active` to false to stop assigning (everyone gets the
 * first arm, the incumbent homepage); bump `epoch` to re-bucket everyone
 * (recorded assignments stop matching, so each visitor is re-assigned 50/50).
 * The campaign tag stamped on the pageview (`campaignTag`) folds in the epoch,
 * so a bump also starts a fresh measurement window — the dashboard widget stops
 * mixing the previous era's numbers with the new one. That matters the moment
 * the two arms render different pages: an epoch that spanned identical arms and
 * one that spans a real A/B must not aggregate together.
 */

/** Shared marker for an arm — the body-class suffix (`variant-a`) and the render
 * discriminator threaded through the home component, so neither re-hardcodes the
 * literal nor couples the arm→marker mapping to array position. */
export type HomepageVariantMarker = "a" | "b";

export interface HomepageSplitVariant {
	readonly slug: string;
	/** The URL this arm was reachable at while the split redirected client-side.
	 * Kept so those routes keep resolving for a browser history entry or a
	 * bookmark minted then, rather than 404ing. */
	readonly path: string;
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
	campaign: "homepage-split",
	// Epoch 3: arm A gained the ways-to-save section, so the control itself
	// changed. Bumping off epoch 2 scopes the widgets to the rewritten arm A
	// rather than averaging the extension-only era into it.
	epoch: 3,
	variants: [
		{ slug: "variant-a", path: "/landing-a", marker: "a" },
		{ slug: "variant-b", path: "/landing-b", marker: "b" },
	],
};

/**
 * Buckets a single unsigned byte (0–255) into one of the two arms. The [0,128)
 * vs [128,256) split is an even 50/50 — 128 of the 256 values fall on each side.
 */
export function assignVariant(config: HomepageSplitConfig, randomByte: number): HomepageSplitVariant {
	return randomByte < 128 ? config.variants[0] : config.variants[1];
}

/**
 * The campaign value stamped on the exposure pageview and matched by the
 * dashboard widget. It folds the epoch into the campaign so a re-bucket also
 * scopes the measurement to that epoch — old-era pageviews carry a different tag
 * and drop out of the widget rather than averaging in.
 */
export function campaignTag(config: HomepageSplitConfig): string {
	return `${config.campaign}-e${config.epoch}`;
}

export function variantBySlug(config: HomepageSplitConfig, slug: string): HomepageSplitVariant | undefined {
	return config.variants.find((variant) => variant.slug === slug);
}
