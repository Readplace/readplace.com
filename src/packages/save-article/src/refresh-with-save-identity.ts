import type { RefreshArticleIfStale, RefreshIdentifiedArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { ResolveSaveIdentity } from "./resolve-save-identity";

interface RefreshWithSaveIdentityDependencies {
	resolveSaveIdentity: ResolveSaveIdentity;
	refreshArticleIfStale: RefreshArticleIfStale;
}

export function initRefreshWithSaveIdentity(deps: RefreshWithSaveIdentityDependencies): {
	refreshArticleIfStale: RefreshIdentifiedArticleIfStale;
} {
	const { resolveSaveIdentity, refreshArticleIfStale: refreshResolvedArticleIfStale } = deps;

	const refreshArticleIfStale: RefreshIdentifiedArticleIfStale = async ({ url, requester }) => {
		const identity = await resolveSaveIdentity(url);
		if (identity.status === "unresolved") return { action: "unresolved", identity };
		const freshness = await refreshResolvedArticleIfStale({ url, requester });
		return freshness.action === "unresolved" ? freshness : { ...freshness, identity };
	};

	return { refreshArticleIfStale };
}
