/**
 * Single source of truth for the homepage A/B split experiment.
 *
 * Browser-safe on purpose (zero node/express imports) so the same constants and
 * pure helpers are shared by the client bundle that assigns + redirects, the
 * landing routes that render each arm, and the analytics dashboard that counts
 * landings by variant — a value change here propagates to all three.
 *
 * Kill switches: flip `active` to false to no-op the client (everyone stays on
 * `/`); bump `epoch` to re-bucket everyone (stored assignments stop matching, so
 * each visitor is re-assigned 50/50) while keeping `campaign` stable so the
 * dashboard widget keeps aggregating.
 */

export interface HomepageSplitVariant {
	readonly slug: string;
	readonly path: string;
}

export interface HomepageSplitConfig {
	readonly active: boolean;
	readonly campaign: string;
	readonly epoch: number;
	readonly storageKey: string;
	readonly variants: readonly [HomepageSplitVariant, HomepageSplitVariant];
}

export const HOMEPAGE_SPLIT: HomepageSplitConfig = {
	active: true,
	campaign: "homepage-split",
	epoch: 1,
	storageKey: "readplace.homepage-split",
	variants: [
		{ slug: "variant-a", path: "/landing-a" },
		{ slug: "variant-b", path: "/landing-b" },
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
 * The redirect target. `utm_medium=experiment` (deliberately not `internal`, so
 * the analytics middleware keeps the pageview instead of dropping it as a click)
 * and `utm_source` omitted (so the landing does not dilute the acquisition pies,
 * which filter on `ispresent(utm_source)`).
 */
export function buildLandingUrl(config: HomepageSplitConfig, variant: HomepageSplitVariant): string {
	return `${variant.path}?utm_campaign=${config.campaign}&utm_medium=experiment&utm_content=${variant.slug}`;
}

export function variantBySlug(config: HomepageSplitConfig, slug: string): HomepageSplitVariant | undefined {
	return config.variants.find((variant) => variant.slug === slug);
}

/** Stored form is `<epoch>:<slug>` so a bumped epoch invalidates old buckets. */
export function formatStoredVariant(config: HomepageSplitConfig, variant: HomepageSplitVariant): string {
	return `${config.epoch}:${variant.slug}`;
}

export function parseStoredVariant(
	config: HomepageSplitConfig,
	raw: string | null,
): HomepageSplitVariant | undefined {
	if (raw === null) return undefined;
	const separator = raw.indexOf(":");
	if (separator === -1) return undefined;
	if (raw.slice(0, separator) !== String(config.epoch)) return undefined;
	return variantBySlug(config, raw.slice(separator + 1));
}
