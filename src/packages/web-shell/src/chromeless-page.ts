import assert from "node:assert";
import { BASE_CSS_VARIABLES, BASE_RESET_STYLES, UTILITY_STYLES } from "./base.styles";
import { CHROMELESS_TEMPLATE } from "./chromeless-page.template";
import type { Component } from "./component.types";
import { HtmlPage } from "./html-page";
import { HTMX_SCRIPTS } from "./htmx-script";
import { injectPageStylesIntoMain } from "./inject-page-styles";
import type { PageBody, SeoMetadata } from "./page-body.types";
import { render } from "./render";

export interface ChromelessPageConfig {
	staticBaseUrl: string;
	liveReload: boolean;
	/** Markup appended to every page this shell serves, after the page's own
	 * scripts. Mirrors `BaseConfig.siteScripts`, so a script the whole site relies
	 * on (rewriting `<time data-local-time>` into the viewer's timezone) reaches
	 * the chromeless pages too rather than freezing at the server's baseline. */
	siteScripts?: string;
}

export type RenderChromelessPage = (body: PageBody) => Component;

/** A shell with no header, nav, footer, banners, toasts, or social metadata —
 * just the page's own <main>, its styles, and htmx. The iOS app loads its in-app
 * pages (the reader, the account page) through this so the WKWebView shows the
 * page alone, with the native app as its chrome instead of the web shell. */
export function initChromelessPage(config: ChromelessPageConfig): RenderChromelessPage {
	const liveReloadScript = config.liveReload
		? `\n<script src="http://localhost:35729/livereload.js?snipver=1"></script>`
		: "";
	const siteScripts = config.siteScripts ?? "";

	return (body: PageBody): Component => {
		const seo: SeoMetadata = body.seo;
		assert(seo.robots, "chromeless pages must declare robots so the reader stays noindex");
		const rendered = render(CHROMELESS_TEMPLATE, {
			staticBaseUrl: config.staticBaseUrl,
			title: seo.title,
			description: seo.description,
			robots: seo.robots,
			bodyClass: body.bodyClass,
			baseStyles: BASE_CSS_VARIABLES,
			resetStyles: BASE_RESET_STYLES,
			utilityStyles: UTILITY_STYLES,
			content: injectPageStylesIntoMain(body.content.html, body.styles),
			scripts: HTMX_SCRIPTS + (body.scripts ?? "") + siteScripts + liveReloadScript,
		});
		return HtmlPage(rendered, body.statusCode);
	};
}
