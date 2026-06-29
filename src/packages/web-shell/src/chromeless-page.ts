import assert from "node:assert";
import { BASE_CSS_VARIABLES, BASE_RESET_STYLES, UTILITY_STYLES } from "./base.styles";
import { CHROMELESS_TEMPLATE } from "./chromeless-page.template";
import type { Component } from "./component.types";
import { HtmlPage } from "./html-page";
import { HTMX_SCRIPTS } from "./htmx-script";
import { injectPageStylesIntoMain } from "./inject-page-styles";
import type { PageBody, SeoMetadata } from "./page-body.types";
import { render } from "./render";

/** Configuration the chromeless shell cannot read for itself. `staticBaseUrl`
 * fronts the favicon referenced in the template; `liveReload` injects the dev
 * livereload script. Mirrors `BaseConfig` minus the chrome the shell omits. */
export interface ChromelessPageConfig {
	staticBaseUrl: string;
	liveReload: boolean;
}

export type RenderChromelessPage = (body: PageBody) => Component;

/** A shell with no header, nav, footer, banners, toasts, or social metadata —
 * just the page's own <main>, its styles, and htmx. The iOS app loads the reader
 * through this so the WKWebView shows the article alone, with the native list as
 * its chrome instead of the web shell. */
export function initChromelessPage(config: ChromelessPageConfig): RenderChromelessPage {
	const liveReloadScript = config.liveReload
		? `\n<script src="http://localhost:35729/livereload.js?snipver=1"></script>`
		: "";

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
			scripts: HTMX_SCRIPTS + (body.scripts ?? "") + liveReloadScript,
		});
		return HtmlPage(rendered, body.statusCode);
	};
}
