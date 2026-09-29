import { toCanonicalHostUrl } from "@packages/article-resource-unique-id";
import type { FindArticleByUrl, GlobalArticleData } from "@packages/provider-contracts/article-store";

export type StoredArticle = { articleUrl: string; existing: GlobalArticleData | null };

export type ResolveStoredArticle = (url: string) => Promise<StoredArticle>;

export function initResolveStoredArticle(deps: {
	resolveCanonicalIdentity: (url: string) => Promise<string>;
	findArticleByUrl: FindArticleByUrl;
}): ResolveStoredArticle {
	const lookUp = async (url: string): Promise<StoredArticle> => {
		const articleUrl = await deps.resolveCanonicalIdentity(url);
		return { articleUrl, existing: await deps.findArticleByUrl(articleUrl) };
	};
	return async (url) => {
		const requested = await lookUp(url);
		const stored = requested.existing !== null || requested.articleUrl !== url;
		const canonicalUrl = toCanonicalHostUrl(url);
		if (stored || canonicalUrl === url) return requested;
		return lookUp(canonicalUrl);
	};
}
