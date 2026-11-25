import { toCanonicalArticleUrl } from "@packages/article-resource-unique-id";

import { ReaderArticleHashId, type ArticleStatus } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { FindArticleById, FindArticlesResult, ResolveCanonicalIdentity } from "@packages/provider-contracts/article-store";

export async function savedArticleUrlPage(input: {
	url: string | undefined;
	userId: UserId;
	status?: ArticleStatus;
	page: number;
	pageSize: number;
	resolveCanonicalIdentity: ResolveCanonicalIdentity;
	findArticleById: FindArticleById;
}): Promise<FindArticlesResult> {
	const page = { page: input.page, pageSize: input.pageSize, hasMore: false };
	if (input.url && URL.canParse(input.url)) {
		// Existing legacy saves win over an equivalent modern URL, even after a host rename.
		for (const candidate of new Set([input.url, toCanonicalArticleUrl(input.url)])) {
			const resolved = await input.resolveCanonicalIdentity(candidate);
			const article = await input.findArticleById(ReaderArticleHashId.from(resolved), input.userId);
			if (article && (!input.status || article.status === input.status)) {
				return { ...page, articles: input.page === 1 ? [article] : [], total: 1 };
			}
		}
	}
	return { ...page, articles: [], total: 0 };
}

export function articlesSavedAt<Article extends { url: string }>(params: {
	articles: readonly Article[];
	url: string;
}): Article[] {
	const requested = params.articles.filter((article) => article.url === params.url);
	if (requested.length > 0) return requested;
	const canonicalUrl = toCanonicalArticleUrl(params.url);
	return params.articles.filter((article) => article.url === canonicalUrl);
}
