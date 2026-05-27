import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import {
	BANNER_AREA_STYLES,
	BASE_CSS_VARIABLES,
	BASE_RESET_STYLES,
	FOOTER_STYLES,
	HEADER_STYLES,
	NAV_STYLES,
	OFFLINE_BANNER_STYLES,
	TRIAL_COUNTDOWN_STYLES,
	VERIFY_BANNER_STYLES,
	UTILITY_STYLES,
} from "./base.styles";
import type { BannerState } from "./banner-state";
import type { Component, ParsedComponent } from "./component.types";
import { HtmlPage } from "./html-page";
import { htmlToMarkdown } from "./html-to-markdown";
import { MarkdownPage } from "./markdown-page";
import { buildMarkdownFrontmatter } from "./markdown-frontmatter";
import { Nav } from "./nav.component";
import type { PageBody, SeoMetadata } from "./page-body.types";
import { render } from "./render";
import {
	EXTENSION_SUGGESTION_BANNER_SCRIPT,
	renderExtensionSuggestionBanner,
} from "./shared/extension-suggestion-banner/extension-suggestion-banner.component";
import { EXTENSION_SUGGESTION_BANNER_STYLES } from "./shared/extension-suggestion-banner/extension-suggestion-banner.styles";
import { getEnv, requireEnv } from "../domain/require-env";

const FOOTER_TEMPLATE = readFileSync(join(__dirname, "footer.template.html"), "utf-8");
const BASE_TEMPLATE = readFileSync(join(__dirname, "base.template.html"), "utf-8");

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

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");

const CANONICAL_ORIGIN = "https://readplace.com";

function normalizeCanonicalUrl(canonicalUrl: string): string {
	const url = new URL(canonicalUrl, CANONICAL_ORIGIN);
	return `${CANONICAL_ORIGIN}${url.pathname}${url.search}${url.hash}`;
}

const LIVERELOAD_SCRIPT = getEnv("LIVERELOAD")
	? `\n<script src="http://localhost:35729/livereload.js?snipver=1"></script>`
	: "";

const HTMX_SCRIPTS = `<script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js" integrity="sha384-/TgkGk7p307TH7EXJDuUlgG3Ce1UVolAOFopFekQkkXihi5u/6OCvVKyz1W+idaz" crossorigin="anonymous"></script><script>htmx.config.scrollBehavior='smooth';</script>`;

const TRIAL_COUNTDOWN_SCRIPT = `<script src="/client-dist/trial-countdown.client.js" defer></script>`;

const OFFLINE_INDICATOR_SCRIPT = `
<script>
(function() {
  var banner = document.querySelector('.offline-banner');
  var bannerArea = document.querySelector('.banner-area');
  if (!banner || !bannerArea) return;

  var wasOffline = false;
  var hideTimeout = null;

  function updateBannerAreaHeight() {
    document.documentElement.style.setProperty(
      '--banner-area-height', bannerArea.offsetHeight + 'px'
    );
  }

  banner.addEventListener('transitionend', updateBannerAreaHeight);

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
        updateBannerAreaHeight();
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
      updateBannerAreaHeight();
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
})();
</script>`;

/**
 * Inject page-specific CSS as a <style> element inside <main>, so that htmx
 * navigation (hx-target="main" hx-select="main" hx-swap="outerHTML") swaps the
 * page's CSS atomically with its content. Without this, htmx leaves the
 * previous page's <style> stranded in <head>, defacing the new page's layout.
 */
function injectPageStylesIntoMain(content: string, styles: string): string {
	if (!styles) return content;
	const { document } = parseHTML(`<!DOCTYPE html><html><body>${content}</body></html>`);
	const main = document.querySelector("main");
	assert(main, "PageBody.content must contain a <main> element when styles are provided");
	const styleEl = document.createElement("style");
	styleEl.textContent = styles;
	main.insertBefore(styleEl, main.firstChild);
	return document.body.innerHTML;
}

function renderStructuredData(data: object[] | undefined): string {
	if (!data || data.length === 0) return "";
	// SECURITY: JSON.stringify is safe for server-controlled data.
	// WARNING: Never interpolate user input into structured data objects.
	return data
		.map(
			(item) =>
				`<script type="application/ld+json">${JSON.stringify(item)}</script>`,
		)
		.join("\n  ");
}

function renderBaseTemplate(body: PageBody, state: BannerState): string {
	const headerVariant = body.headerVariant || "default";
	const seo: SeoMetadata = body.seo;

	const ogType = seo.ogType || "website";
	const robots = seo.robots || "index, follow";

	return render(BASE_TEMPLATE, {
		staticBaseUrl: STATIC_BASE_URL,
		title: seo.title,
		description: seo.description,
		canonicalUrl: normalizeCanonicalUrl(seo.canonicalUrl),
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
		headerStyles: HEADER_STYLES,
		navStyles: NAV_STYLES,
		footerStyles: FOOTER_STYLES,
		offlineBannerStyles: OFFLINE_BANNER_STYLES,
		verifyBannerStyles: VERIFY_BANNER_STYLES,
		trialCountdownStyles: TRIAL_COUNTDOWN_STYLES,
		extensionSuggestionBannerStyles: EXTENSION_SUGGESTION_BANNER_STYLES,
		showVerificationBanner: state.isAuthenticated && state.emailVerified === false,
		extensionSuggestionBanner: renderExtensionSuggestionBanner({
			show: state.showExtensionSuggestionBanner ?? false,
			extensionInstalled: state.extensionInstalled ?? false,
		}),
		bodyClass: body.bodyClass,
		header: Nav({
			variant: headerVariant,
			isAuthenticated: state.isAuthenticated,
			accessIsReadOnly: state.accessIsReadOnly ?? false,
			trialCounter: state.trial,
		}),
		content: injectPageStylesIntoMain(body.content.html, body.styles),
		footer: renderFooter(),
		navScript: NAV_SCRIPT,
		offlineScript: OFFLINE_INDICATOR_SCRIPT,
		scripts:
			HTMX_SCRIPTS +
			EXTENSION_SUGGESTION_BANNER_SCRIPT +
			(state.trial?.state === "active" ? TRIAL_COUNTDOWN_SCRIPT : "") +
			(body.scripts ?? "") +
			LIVERELOAD_SCRIPT,
	});
}

function renderMarkdown(body: PageBody): string {
	const frontmatter = buildMarkdownFrontmatter(body.seo, {
		formattedDate: body.markdownFormattedDate,
	});
	const content = body.content.markdown ?? htmlToMarkdown(body.content.html);
	return `${frontmatter}\n\n${content}`;
}

export function Base(body: PageBody, state: BannerState): Component {
	return {
		to: (mediaType): ParsedComponent => {
			if (mediaType === "text/markdown") {
				return MarkdownPage(renderMarkdown(body), body.statusCode).to(mediaType);
			}
			return HtmlPage(renderBaseTemplate(body, state), body.statusCode).to(mediaType);
		},
	};
}
