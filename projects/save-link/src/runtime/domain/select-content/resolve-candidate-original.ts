import assert from "node:assert";
import { type WrapperFamily, isStoredWrapperUrl, unwrapWrapperUrl, wrapperFamilyOf } from "@packages/domain/article";
import type { FindIdentityRow } from "@packages/provider-contracts/article-store";

const OWN_ORIGINAL_IDENTITY_FAMILIES: ReadonlySet<WrapperFamily> = new Set(["apple-news", "archive-snapshot"]);

function standsAsItsOwnOriginal(url: string): boolean {
	const family = wrapperFamilyOf(url);
	return family !== undefined && OWN_ORIGINAL_IDENTITY_FAMILIES.has(family) && unwrapWrapperUrl(url).url === url;
}

export function initResolveCandidateOriginal(deps: { findIdentityRow: FindIdentityRow }): (url: string) => Promise<string> {
	return async (url) => {
		const row = await deps.findIdentityRow(url);
		assert(row.kind === "article", "candidate must belong to an existing article");
		const originalUrl = row.originalUrl ?? url;
		assert(!isStoredWrapperUrl(originalUrl) || standsAsItsOwnOriginal(originalUrl), "a wrapper cannot be the article identity");
		return originalUrl;
	};
}
