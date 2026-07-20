import assert from "node:assert";
import {
	BANNER_AREA_STYLES,
	BASE_CSS_VARIABLES,
	BASE_RESET_STYLES,
	CHANGELOG_BANNER_STYLES,
	FOOTER_STYLES,
	HEADER_STYLES,
	NAV_STYLES,
	OFFLINE_BANNER_STYLES,
	TRIAL_COUNTDOWN_STYLES,
	VERIFY_BANNER_STYLES,
	UTILITY_STYLES,
} from "./base.styles";
import { BASE_TEMPLATE } from "./base.template";
import { FOOTER_TEMPLATE } from "./footer.template";
import type { BannerState } from "./banner-state";
import { renderChangelogBannerShell } from "./changelog-banner";
import type { Component, ParsedComponent } from "./component.types";
import { HtmlPage } from "./html-page";
import { HTMX_SCRIPTS } from "./htmx-script";
import { injectPageStylesIntoMain } from "./inject-page-styles";
import { htmlToMarkdown } from "./html-to-markdown";
import { MarkdownPage } from "./markdown-page";
import { buildMarkdownFrontmatter } from "./markdown-frontmatter";
import type { NavProps } from "./nav.component";
import type { TrialDisplay } from "./trial-countdown.format";
import type { PageBody, SeoMetadata } from "./page-body.types";
import { render } from "./render";
import {
	EXTENSION_SUGGESTION_BANNER_SCRIPT,
	renderExtensionSuggestionBanner,
} from "./shared/extension-suggestion-banner/extension-suggestion-banner.component";
import { EXTENSION_SUGGESTION_BANNER_STYLES } from "./shared/extension-suggestion-banner/extension-suggestion-banner.styles";
import { renderVerifyBanner } from "./shared/verify-banner/verify-banner.component";
import { TOAST_STYLES } from "./shared/toast/toast.styles";

function renderFooter(): string {
	return render(FOOTER_TEMPLATE, {
		year: new Date().getFullYear(),
	});
}

const NAV_SCRIPT = `
<script>
(function() {
  var toggle = document.querySelector('.nav__toggle');
  var menu = document.querySelector('.nav__menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', function() {
    var expanded = this.getAttribute('aria-expanded') === 'true';
    this.setAttribute('aria-expanded', String(!expanded));
    menu.classList.toggle('nav__menu--open', !expanded);
  });

  document.addEventListener('click', function(e) {
    var isToggleVisible = window.getComputedStyle(toggle).display !== 'none';
    if (isToggleVisible && !e.target.closest('.nav')) {
      toggle.setAttribute('aria-expanded', 'false');
      menu.classList.remove('nav__menu--open');
    }
  });
})();
</script>`;

const CANONICAL_ORIGIN = "https://readplace.com";

function normalizeCanonicalUrl(canonicalUrl: string): string {
	const url = new URL(canonicalUrl, CANONICAL_ORIGIN);
	return `${CANONICAL_ORIGIN}${url.pathname}${url.search}${url.hash}`;
}

function externalCanonicalUrl(canonicalUrl: string): string {
	assert(
		/^https?:\/\//i.test(canonicalUrl),
		`canonicalIsExternal requires an absolute http(s) URL, received: ${canonicalUrl}`,
	);
	return new URL(canonicalUrl).href;
}

const TRIAL_COUNTDOWN_SCRIPT = `<script src="/client-dist/trial-countdown.client.js" defer></script>`;

function trialChipCarriesInstant(trial: TrialDisplay | undefined): boolean {
	return trial !== undefined && trial.state !== "expired";
}

/** Global so any page's toast auto-dismisses — including one that arrives
 * inside an htmx-swapped <main>, which a page-scoped script would never see. */
const TOAST_SCRIPT = `<script src="/client-dist/toast.client.js" defer></script>`;

const OFFLINE_INDICATOR_SCRIPT = `
<script>
(function() {
  var banner = document.querySelector('.offline-banner');
  if (!banner) return;

  var wasOffline = false;
  var hideTimeout = null;

  function updateOnlineStatus() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    if (navigator.onLine) {
      if (wasOffline) {
        banner.textContent = 'Back online';
        banner.classList.add('offline-banner--visible');
        banner.setAttribute('aria-hidden', 'false');
        hideTimeout = setTimeout(function() {
          banner.classList.remove('offline-banner--visible');
          banner.setAttribute('aria-hidden', 'true');
        }, 2000);
      } else {
        banner.classList.remove('offline-banner--visible');
        banner.setAttribute('aria-hidden', 'true');
      }
      wasOffline = false;
    } else {
      wasOffline = true;
      banner.textContent = "You're offline. Some features may be unavailable.";
      banner.classList.add('offline-banner--visible');
      banner.setAttribute('aria-hidden', 'false');
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
})();
</script>`;

/**
 * Escape HTML-significant code points inside a JSON string before embedding it
 * in a <script>. JSON.stringify does NOT escape `<`, `>`, `&`, or the Unicode
 * line separators, so a value containing `</script>` would break out of the
 * JSON-LD block and inject executable markup. Structured-data values can come
 * from crawled, attacker-controlled metadata (e.g. an article's <title> on
 * /view), so this is mandatory. The escaped sequences decode back during JSON
 * parsing; schema.org consumers are unaffected.
 */
function escapeJsonForScript(json: string): string {
	return json
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

function renderStructuredData(data: object[] | undefined): string {
	if (!data || data.length === 0) return "";
	return data
		.map(
			(item) =>
				`<script type="application/ld+json">${escapeJsonForScript(JSON.stringify(item))}</script>`,
		)
		.join("\n  ");
}

function renderMarkdown(body: PageBody): string {
	const frontmatter = buildMarkdownFrontmatter(body.seo, {
		formattedDate: body.markdownFormattedDate,
	});
	const content = body.content.markdown ?? htmlToMarkdown(body.content.html);
	return `${frontmatter}\n\n${content}`;
}

/** Site-level configuration the shell cannot read for itself. `staticBaseUrl`
 * is the origin that fronts the favicons/fonts referenced in the page template
 * (each consuming site points it at static.readplace.com); `liveReload`
 * injects the dev livereload script. Both are injected rather than read from
 * the environment so the package stays free of process.env coupling and can
 * be reused by sites that resolve these values differently. */
export interface BaseConfig {
	staticBaseUrl: string;
	liveReload: boolean;
	/** Markup appended to every page this site serves, after the page's own
	 * scripts. Lets a consuming site inject a site-wide script (e.g. hutch's
	 * WebMCP tool registration) without each page opting in, while a site that
	 * omits it — like the blog, which ships no such bundle — stays untouched. */
	siteScripts?: string;
	/** The site's nav renderer. Mandatory (no default) so every shell states its
	 * nav explicitly: a site with a nav passes `GlobalNav`, a bare shell passes
	 * `GlobalEmptyNav`. */
	renderNav: RenderSiteNav;
}

export type RenderSiteNav = (props: NavProps) => string;

export type RenderBase = (body: PageBody, state: BannerState) => Component;

export function initBase(config: BaseConfig): RenderBase {
	const liveReloadScript = config.liveReload
		? `\n<script src="http://localhost:35729/livereload.js?snipver=1"></script>`
		: "";

	const siteScripts = config.siteScripts ?? "";

	function renderBaseTemplate(body: PageBody, state: BannerState): string {
		const headerVariant = body.headerVariant || "default";
		const seo: SeoMetadata = body.seo;

		const ogType = seo.ogType || "website";
		const robots = seo.robots || "index, follow";

		const canonicalUrl = seo.canonicalIsExternal
			? externalCanonicalUrl(seo.canonicalUrl)
			: normalizeCanonicalUrl(seo.canonicalUrl);
		const ogUrl = seo.ogUrl ? normalizeCanonicalUrl(seo.ogUrl) : canonicalUrl;

		return render(BASE_TEMPLATE, {
			staticBaseUrl: config.staticBaseUrl,
			title: seo.title,
			description: seo.description,
			canonicalUrl,
			ogUrl,
			ogType,
			ogImage: seo.ogImage,
			ogImageAlt: seo.ogImageAlt,
			ogImageType: seo.ogImageType,
			twitterImage: seo.twitterImage ?? seo.ogImage,
			twitterSite: seo.twitterSite,
			robots,
			author: seo.author,
			keywords: seo.keywords,
			structuredDataScript: renderStructuredData(seo.structuredData),
			baseStyles: BASE_CSS_VARIABLES,
			resetStyles: BASE_RESET_STYLES,
			utilityStyles: UTILITY_STYLES,
			bannerAreaStyles: BANNER_AREA_STYLES,
			changelogBannerStyles: CHANGELOG_BANNER_STYLES,
			headerStyles: HEADER_STYLES,
			navStyles: NAV_STYLES,
			footerStyles: FOOTER_STYLES,
			offlineBannerStyles: OFFLINE_BANNER_STYLES,
			toastStyles: TOAST_STYLES,
			verifyBannerStyles: VERIFY_BANNER_STYLES,
			trialCountdownStyles: TRIAL_COUNTDOWN_STYLES,
			extensionSuggestionBannerStyles: EXTENSION_SUGGESTION_BANNER_STYLES,
			changelogBanner: renderChangelogBannerShell(state.changelogBanner, state.currentPath, {
				suppressSeenScript: state.suppressChangelogSeenScript,
			}),
			verifyBanner: renderVerifyBanner(state),
			extensionSuggestionBanner: renderExtensionSuggestionBanner({
				show: state.showExtensionSuggestionBanner ?? false,
				extensionInstalled: state.extensionInstalled ?? false,
			}),
			bodyClass: body.bodyClass,
			header: config.renderNav({
				variant: headerVariant,
				isAuthenticated: state.isAuthenticated,
				accessIsReadOnly: state.accessIsReadOnly ?? false,
				now: new Date(),
				trialCounter: state.trial,
			}),
			content: injectPageStylesIntoMain(body.content.html, body.styles),
			footer: renderFooter(),
			navScript: NAV_SCRIPT,
			offlineScript: OFFLINE_INDICATOR_SCRIPT,
			scripts:
				HTMX_SCRIPTS +
				EXTENSION_SUGGESTION_BANNER_SCRIPT +
				TOAST_SCRIPT +
				(trialChipCarriesInstant(state.trial) ? TRIAL_COUNTDOWN_SCRIPT : "") +
				(body.scripts ?? "") +
				siteScripts +
				liveReloadScript,
		});
	}

	return (body, state): Component => ({
		to: (mediaType): ParsedComponent => {
			if (mediaType === "text/markdown") {
				return MarkdownPage(renderMarkdown(body), body.statusCode).to(mediaType);
			}
			return HtmlPage(renderBaseTemplate(body, state), body.statusCode).to(mediaType);
		},
	});
}
