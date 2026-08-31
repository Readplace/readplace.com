/**
 * The homepage renders one page for everyone; this label rides its pageview so
 * the retired variant-a / variant-b arms and this page stay separable in the
 * analytics stream while both are inside the log group's retention window.
 */
export const HOMEPAGE_EXPOSURE = {
	campaign: "homepage",
	version: "variant-c",
} as const;
