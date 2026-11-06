export const SUPPORTED_LOCALES = ["en-US"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE = "en-US" satisfies SupportedLocale;

export function isSupportedLocale(value: unknown): value is SupportedLocale {
	return SUPPORTED_LOCALES.some((locale) => locale === value);
}
