import { toCanonicalArticleUrl } from "@packages/article-resource-unique-id";
import type { Viewer } from "@packages/domain/article";
import type { FindArticleByUrl, GlobalArticleData } from "@packages/provider-contracts/article-store";

export type StoredArticle = { articleUrl: string; existing: GlobalArticleData | null };

export type ResolveStoredArticle = (url: string, viewer: Viewer) => Promise<StoredArticle>;

export function initResolveStoredArticle(deps: {
	resolveCanonicalIdentity: (url: string) => Promise<string>;
	findArticleByUrl: FindArticleByUrl;
}): ResolveStoredArticle {
	const lookUp = async (url: string, viewer: Viewer): Promise<StoredArticle> => {
		const articleUrl = await deps.resolveCanonicalIdentity(url);
		return { articleUrl, existing: await deps.findArticleByUrl(articleUrl, viewer) };
	};
	return async (url, viewer) => {
		const requested = await lookUp(url, viewer);
		const stored = requested.existing !== null || requested.articleUrl !== url;
		const canonicalUrl = toCanonicalArticleUrl(url);
		if (stored || canonicalUrl === url) return requested;
		return lookUp(canonicalUrl, viewer);
	};
}
