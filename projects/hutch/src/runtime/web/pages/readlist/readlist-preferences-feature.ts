import { QuerystringFeatureToggle } from "@packages/web-shell";
import type { ReadlistSlug } from "@packages/domain/readlist";

import {
	readlistPreferencesInboxesPath,
	readlistPreferencesPath,
	type LinkParams,
} from "./readlist.url";

export const READLIST_PREFERENCES_FEATURE = "pref";

const featureToggle = new QuerystringFeatureToggle();

export function readlistPreferencesEnabled(query: Record<string, unknown>): boolean {
	return featureToggle.isEnabled({ query }, READLIST_PREFERENCES_FEATURE);
}

export function preferencesFeatureParams(enabled: boolean): LinkParams {
	return enabled ? [["feature", READLIST_PREFERENCES_FEATURE]] : [];
}

function withPreferencesFeature(input: {
	path: string;
	enabled: boolean;
	extra?: LinkParams;
}): string {
	const params = new URLSearchParams();
	for (const [key, value] of input.extra ?? []) params.append(key, value);
	for (const [key, value] of preferencesFeatureParams(input.enabled)) params.append(key, value);
	const search = params.toString();
	return search ? `${input.path}?${search}` : input.path;
}

export function preferencesUrl(input: {
	slug: ReadlistSlug;
	enabled: boolean;
	extra?: LinkParams;
}): string {
	return withPreferencesFeature({
		path: readlistPreferencesPath(input.slug),
		enabled: input.enabled,
		extra: input.extra,
	});
}

export function preferencesInboxesUrl(input: { slug: ReadlistSlug; enabled: boolean }): string {
	return withPreferencesFeature({
		path: readlistPreferencesInboxesPath(input.slug),
		enabled: input.enabled,
	});
}
