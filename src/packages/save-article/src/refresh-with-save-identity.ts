import type { RefreshArticleIfStale, RefreshIdentifiedArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { ResolveSaveIdentity } from "./resolve-save-identity";

export interface RefreshWithSaveIdentityDependencies {
	resolveSaveIdentity: ResolveSaveIdentity;
	refreshArticleIfStale: RefreshArticleIfStale;
}

export function initRefreshWithSaveIdentity(deps: RefreshWithSaveIdentityDependencies): {
	refreshArticleIfStale: RefreshIdentifiedArticleIfStale;
} {
	const { resolveSaveIdentity, refreshArticleIfStale: refreshResolvedArticleIfStale } = deps;

	const refreshArticleIfStale: RefreshIdentifiedArticleIfStale = async ({ url }) => {
		const identity = await resolveSaveIdentity(url);
		if (identity.status === "unresolved") return { action: "unresolved", identity };
		const freshness = await refreshResolvedArticleIfStale({ url });
		return freshness.action === "unresolved" ? freshness : { ...freshness, identity };
	};

	return { refreshArticleIfStale };
}
