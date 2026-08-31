export interface SeoMetadata {
	title: string;
	description: string;
	canonicalUrl: string;
	/** When true, `canonicalUrl` is kept as a cross-origin URL instead of being
	 * forced onto readplace.com — `/view` points its canonical at the original
	 * publisher so search/answer engines attribute the text to the source rather
	 * than reading readplace.com as a scraper proxy. */
	canonicalIsExternal?: boolean;
	/** Overrides the page's `<meta property="og:url">` independently of
	 * `canonicalUrl`. Defaults to `canonicalUrl` when absent. `/view` sets this
	 * to the readplace wrapper so social shares preserve readplace's Open Graph
	 * object identity (the downloaded thumbnail + reader content), while
	 * `<link rel="canonical">` stays on the publisher for attribution. */
	ogUrl?: string;
	ogImage?: string;
	ogImageAlt?: string;
	ogImageType?: string;
	twitterImage?: string;
	twitterSite?: string;
	ogType?: "website" | "article";
	robots?: string;
	author?: string;
	keywords?: string;
	/** Safari Smart App Banner payload (`app-id=…`). Opt-in per page, because the
	 * iOS app runs `/oauth/authorize` in an `ASWebAuthenticationSession`: an
	 * "Open in app" strip in front of a user who is already in the app, mid
	 * sign-in, is the hand-off App Store review rejected under Guideline 4. */
	appleItunesApp?: string;
	structuredData?: object[];
}

export interface PageBody {
	seo: SeoMetadata;
	styles: string;
	headerVariant?: "default" | "transparent";
	bodyClass?: string;
	/** Whether this page follows the viewer's system theme even with nobody
	 * signed in. Only the public reader sets it: dark mode there is a reading
	 * setting, while every other logged-out page is designed art that a
	 * system-driven flip would repaint into a scheme nobody chose. */
	followsSystemTheme?: boolean;
	content: { html: string; markdown?: string };
	markdownFormattedDate?: string;
	scripts?: string;
	statusCode?: number;
}
