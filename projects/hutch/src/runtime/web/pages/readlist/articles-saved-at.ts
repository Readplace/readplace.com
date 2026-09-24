import { toCanonicalHostUrl } from "@packages/article-resource-unique-id";

export function articlesSavedAt<Article extends { url: string }>(params: {
	articles: readonly Article[];
	url: string;
}): Article[] {
	const requested = params.articles.filter((article) => article.url === params.url);
	if (requested.length > 0) return requested;
	const canonicalUrl = toCanonicalHostUrl(params.url);
	return params.articles.filter((article) => article.url === canonicalUrl);
}
