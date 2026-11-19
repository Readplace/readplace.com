import { z } from "zod";

const StorefrontCountryCodeSchema = z
	.string()
	.regex(/^[A-Z]{3}$/)
	.brand<"StorefrontCountryCode">();
export type StorefrontCountryCode = z.infer<typeof StorefrontCountryCodeSchema>;

export function parseStorefrontCountryCode(raw: unknown): StorefrontCountryCode | undefined {
	const parsed = StorefrontCountryCodeSchema.safeParse(raw);
	return parsed.success ? parsed.data : undefined;
}

const GeneratedContentAccessSchema = z.enum(["shown", "withheld"]).brand<"GeneratedContentAccess">();
export type GeneratedContentAccess = z.infer<typeof GeneratedContentAccessSchema>;

const MAINLAND_CHINA_VIEWER_COUNTRY = "CN";
const MAINLAND_CHINA_STOREFRONT = "CHN";

export function generatedContentAccessFor(signals: {
	viewerCountry: string | undefined;
	storefront: StorefrontCountryCode | undefined;
}): GeneratedContentAccess {
	const inMainlandChina =
		signals.viewerCountry === MAINLAND_CHINA_VIEWER_COUNTRY || signals.storefront === MAINLAND_CHINA_STOREFRONT;
	return GeneratedContentAccessSchema.parse(inMainlandChina ? "withheld" : "shown");
}

export const GENERATED_CONTENT_OUTSIDE_A_REQUEST: GeneratedContentAccess = GeneratedContentAccessSchema.parse("shown");

export const SUMMARY_WITHHELD_REASON = "generated-content-withheld";
