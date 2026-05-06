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
	scripts?: string;
	statusCode?: number;
}
