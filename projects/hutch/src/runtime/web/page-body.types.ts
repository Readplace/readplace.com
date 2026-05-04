export interface SeoMetadata {
	title: string;
	description: string;
	canonicalUrl: string;
	ogImage?: string;
	ogImageAlt?: string;
	ogImageType?: string;
	twitterImage?: string;
	twitterSite?: string;
	ogType?: "website" | "article";
	robots?: string;
	author?: string;
	keywords?: string;
	structuredData?: object[];
}

export interface PageBody {
	seo: SeoMetadata;
	styles: string;
	headerVariant?: "default" | "transparent";
	bodyClass?: string;
	content: string;
	/** When set, the markdown branch of `Base()` serves this verbatim instead
	 * of converting `content` from HTML. Used by routes that want to ship a
	 * subset of the page (e.g., /view returns only the article body, not the
	 * surrounding share/save UI). */
	markdownContent?: string;
	markdownFormattedDate?: string;
	scripts?: string;
	statusCode?: number;
}
