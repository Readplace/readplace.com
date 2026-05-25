export interface ArticleHeadMetadata {
	imageUrl?: string;
	title?: string;
	excerpt?: string;
	siteName?: string;
}

export type ExtractArticleHeadMetadata = (params: {
	articleUrl: string;
}) => Promise<ArticleHeadMetadata>;
