import { unwrapWrapperUrl } from "@packages/domain/article";
import type { FindIdentityRow, ResolveCanonicalIdentity } from "@packages/provider-contracts/article-store";

export type StoredIdentity = {
	url: string;
	row: "article" | "alias-target" | "absent";
	contentSourceUrl?: string;
};

export async function locateStoredIdentity(findIdentityRow: FindIdentityRow, url: string): Promise<StoredIdentity> {
	const direct = await findIdentityRow(url);
	if (direct.kind === "article") return { url, row: "article" };
	if (direct.kind === "alias") return { url: direct.targetUrl, row: "alias-target" };
	const unwrapped = unwrapWrapperUrl(url);
	if (unwrapped.url === url) return { url, row: "absent" };
	const original = await findIdentityRow(unwrapped.url);
	if (original.kind === "alias") return { url: original.targetUrl, row: "alias-target" };
	return { url: unwrapped.url, row: original.kind, contentSourceUrl: unwrapped.contentSourceUrl };
}

export function initResolveCanonicalIdentity(deps: { findIdentityRow: FindIdentityRow }): ResolveCanonicalIdentity {
	return async (url) => (await locateStoredIdentity(deps.findIdentityRow, url)).url;
}
