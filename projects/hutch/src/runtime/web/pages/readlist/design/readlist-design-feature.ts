import { QuerystringFeatureToggle } from "@packages/web-shell";

import { READLIST_PATH, type LinkParams, type ReadlistUrlState, buildReadlistUrl } from "../readlist.url";

export const READLIST_DESIGN_FEATURE = "design";

const FEATURE_QUERY_KEY = "feature";

const featureToggle = new QuerystringFeatureToggle();

export function readlistDesignEnabled(query: Record<string, unknown>, byDefault: boolean): boolean {
	if (byDefault) return true;
	return featureToggle.isEnabled({ query }, READLIST_DESIGN_FEATURE);
}

export function designFeatureParams(enabled: boolean): LinkParams {
	return enabled ? [[FEATURE_QUERY_KEY, READLIST_DESIGN_FEATURE]] : [];
}

export function designFeatureParamsFrom(query: Record<string, unknown>, byDefault: boolean): LinkParams {
	return designFeatureParams(readlistDesignEnabled(query, byDefault));
}

const RESOLVE_ORIGIN = "http://internal.invalid";

export function withDesignFeature(url: string): string {
	const resolved = new URL(url, RESOLVE_ORIGIN);
	resolved.searchParams.set(FEATURE_QUERY_KEY, READLIST_DESIGN_FEATURE);
	return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export function readlistDesignReturnQuery(state: Partial<ReadlistUrlState>): string {
	return buildReadlistUrl(state, designFeatureParams(true)).slice(READLIST_PATH.length);
}
