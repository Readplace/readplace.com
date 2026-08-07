import assert from "node:assert";
import {
	BASE_CSS_VARIABLES,
	BASE_RESET_STYLES,
	CHANGELOG_BANNER_STYLES,
	CHROMELESS_BANNER_AREA_STYLES,
	UTILITY_STYLES,
} from "./base.styles";
import type { ChangelogBanner } from "./changelog-banner";
import { renderChangelogBannerShell } from "./changelog-banner";
import { CHROMELESS_TEMPLATE } from "./chromeless-page.template";
import type { Component } from "./component.types";
import type { CspNonce } from "./csp-nonce.middleware";
import { HtmlPage } from "./html-page";
import { htmxScripts } from "./htmx-script";
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

/** The only shell state the chromeless reader renders: the site-wide
 * announcement and the path its dismiss form returns to. A narrow slice rather
 * than the whole `BannerState` — this shell has no header, nav, trial countdown,
 * verify banner, or toast to feed, so accepting the full state would advertise
 * inputs it silently drops. */
export interface ChromelessBannerState {
	changelogBanner?: ChangelogBanner;
	currentPath?: string;
	cspNonce: CspNonce;
}

export type RenderChromelessPage = (body: PageBody, state: ChromelessBannerState) => Component;

/** A shell with no header, nav, footer, toasts, or social metadata — just the
 * page's own <main>, an optional site-wide changelog announcement, its styles,
 * and htmx. The iOS app loads its in-app pages (the reader, the account page)
 * through this so the WKWebView shows the page alone, with the native app as its
 * chrome instead of the web shell. */
export function initChromelessPage(config: ChromelessPageConfig): RenderChromelessPage {
	const liveReloadScript = config.liveReload
		? `\n<script src="http://localhost:35729/livereload.js?snipver=1"></script>`
		: "";
	const siteScripts = config.siteScripts ?? "";

	return (body: PageBody, state: ChromelessBannerState): Component => {
		const seo: SeoMetadata = body.seo;
		assert(seo.robots, "chromeless pages must declare robots so the reader stays noindex");
		const rendered = render(CHROMELESS_TEMPLATE, {
			staticBaseUrl: config.staticBaseUrl,
			cspNonce: state.cspNonce,
			title: seo.title,
			description: seo.description,
			robots: seo.robots,
			bodyClass: body.bodyClass,
			baseStyles: BASE_CSS_VARIABLES,
			resetStyles: BASE_RESET_STYLES,
			utilityStyles: UTILITY_STYLES,
			bannerAreaStyles: CHROMELESS_BANNER_AREA_STYLES,
			changelogBannerStyles: CHANGELOG_BANNER_STYLES,
			changelogBanner: renderChangelogBannerShell({
				banner: state.changelogBanner,
				returnTo: state.currentPath,
				cspNonce: state.cspNonce,
			}),
			content: injectPageStylesIntoMain({
				content: body.content.html,
				styles: body.styles,
				cspNonce: state.cspNonce,
			}),
			scripts: htmxScripts(state.cspNonce) + (body.scripts ?? "") + siteScripts + liveReloadScript,
		});
		return HtmlPage(rendered, body.statusCode);
	};
}
