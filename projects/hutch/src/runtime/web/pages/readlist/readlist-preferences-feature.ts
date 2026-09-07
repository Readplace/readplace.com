import { QuerystringFeatureToggle } from "@packages/web-shell";
import type { ReadlistSlug } from "@packages/domain/readlist";

import { readlistPreferencesPath, type LinkParams } from "./readlist.url";

export const READLIST_PREFERENCES_FEATURE = "pref";

const featureToggle = new QuerystringFeatureToggle();

export function readlistPreferencesEnabled(query: Record<string, unknown>): boolean {
	return featureToggle.isEnabled({ query }, READLIST_PREFERENCES_FEATURE);
}

export function preferencesFeatureParams(enabled: boolean): LinkParams {
	return enabled ? [["feature", READLIST_PREFERENCES_FEATURE]] : [];
}

export function preferencesUrl(input: {
	slug: ReadlistSlug;
	enabled: boolean;
	extra?: LinkParams;
}): string {
	const params = new URLSearchParams();
	for (const [key, value] of input.extra ?? []) params.append(key, value);
	for (const [key, value] of preferencesFeatureParams(input.enabled)) params.append(key, value);
	const search = params.toString();
	const path = readlistPreferencesPath(input.slug);
	return search ? `${path}?${search}` : path;
}
