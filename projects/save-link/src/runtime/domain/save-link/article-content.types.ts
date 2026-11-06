export type ArticleContentResult = { content: string; imageUrl?: string };
export type FindArticleContent = (url: string) => Promise<ArticleContentResult | undefined>;
