import type { CspNonce } from "./csp-nonce.middleware";
import { type ClickSurface, withClickSurface } from "./internal-link-tracking";
import { render } from "./render";

/** An opaque lowercase-hex fingerprint of the announcing post (`CHANGELOG_VERSION_LENGTH`
 * chars), branded so its shape is single-sourced across the deploy boundary. The
 * only way to obtain one is `isChangelogVersion`, so the producer (blog-site) and
 * hutch's dismiss route cannot drift to different notions
 * of a valid version without a type error — they share this contract by name, never
 * a re-declared regex (connascence of name, compiler-enforced). */
export type ChangelogVersion = string & { readonly __brand: "ChangelogVersion" };

/** The width, in lowercase-hex characters, of a `ChangelogVersion`. Both the
 * validator's shape (`VERSION_PATTERN`) and the producer's hash truncation
 * (blog-site's `deriveChangelogBanner`) derive from this one constant, so the
 * version length is single-sourced alongside its charset — the blog-site↔hutch
 * boundary cannot drift to disagreeing widths, and changing the fingerprint width
 * is a one-line edit here. */
export const CHANGELOG_VERSION_LENGTH = 8;

const VERSION_PATTERN = new RegExp(`^[0-9a-f]{${CHANGELOG_VERSION_LENGTH}}$`);

/** The sole validator and narrowing gate for a ChangelogVersion. A value that
 * crossed a boundary — a posted form field, a
 * freshly hashed slug — is checked here once; callers narrow to the brand through
 * this predicate instead of re-testing the shape, so the version contract has a
 * single definition the compiler keeps every call site honest about. */
export function isChangelogVersion(value: unknown): value is ChangelogVersion {
	return typeof value === "string" && VERSION_PATTERN.test(value);
}

/** A single site-wide feature announcement. `hook` is the human-facing
 * one-liner, `href` the root-relative link to the announcing blog post (already
 * UTM-tagged by the producer), and `version` an opaque fingerprint of the post
 * that drives dismissal: the close button posts it back, the cookie stores it.
 * The version is produced only by
 * blog-site — no other code re-hashes it, so a
 * reader's dismissal always matches the banner they saw. */
export interface ChangelogBanner {
	hook: string;
	href: string;
	version: ChangelogVersion;
}

/** path:"/" + the readplace.com origin make it readable by both
 * Lambdas, so dismissing on /blog also dismisses on the app and vice versa. */
export const CHANGELOG_DISMISS_COOKIE_NAME = "rp_changelog_dismissed";

/** The single localStorage key recording the last banner version this browser
 * has seen. One key (not one-per-version) so a newer post overwrites the
 * previous value and the entry never grows unbounded. Single-sourced here so
 * consumers cannot drift. */
export const CHANGELOG_SEEN_STORAGE_KEY = "readplace.changelog-seen";

/** Runs synchronously before paint, so an already-seen banner never flashes its
 * NEW chip. It reads the version off the banner's data attribute — never
 * interpolated into this JS, so the script is a static string with no injection
 * surface. Storage access is guarded so private-mode throws leave NEW visible. */
export const CHANGELOG_SEEN_SCRIPT = `(function(){var banner=document.querySelector('.changelog-banner[data-changelog-version]');if(!banner)return;var version=banner.getAttribute('data-changelog-version');try{if(localStorage.getItem('${CHANGELOG_SEEN_STORAGE_KEY}')===version){banner.classList.add('changelog-banner--seen');}else{localStorage.setItem('${CHANGELOG_SEEN_STORAGE_KEY}',version);}}catch(e){}})();`;

/** The visible banner, rendered identically by both deployables through the
 * shell. Always emits the `.changelog-banner` element — `--visible` with content
 * when a banner is present, `--hidden` and empty otherwise — so the markup is
 * stable for tests and SSR. The close control
 * is a no-JS POST form carrying the rendered version (so the dismissal records
 * exactly the announcement the reader saw) and the page's own path as `returnTo`
 * (so the dismiss route sends the reader back where they were rather than the
 * homepage — it cannot read `Referer`, which helmet's default `no-referrer`
 * policy strips from the POST). */
const CHANGELOG_SHELL_TEMPLATE = `<div class="changelog-banner {{#if visible}}changelog-banner--visible{{else}}changelog-banner--hidden{{/if}}" role="status" aria-live="polite" data-test-changelog-banner{{#if visible}} data-changelog-version="{{version}}"{{/if}}>{{#if visible}}<div class="changelog-banner__inner"><span class="changelog-banner__chip" aria-hidden="true">NEW</span><span class="changelog-banner__hook">{{hook}}</span><a class="changelog-banner__link" href="{{href}}">Read more {{icon "arrow-right"}}</a><form class="changelog-banner__dismiss" method="POST" action="{{track '/banner/changelog/dismiss' source='changelog-banner' content='dismiss' term=clickSurface}}"><input type="hidden" name="version" value="{{version}}"><input type="hidden" name="returnTo" value="{{returnTo}}"><button type="submit" class="changelog-banner__close" aria-label="Dismiss changelog banner">{{icon "x"}}</button></form></div>{{#if seenScript}}<script nonce="{{cspNonce}}">${CHANGELOG_SEEN_SCRIPT}</script>{{/if}}{{/if}}</div>`;

export function renderChangelogBannerShell(input: {
	banner?: ChangelogBanner;
	returnTo?: string;
	cspNonce: CspNonce;
	clickSurface?: ClickSurface;
}): string {
	return render(CHANGELOG_SHELL_TEMPLATE, {
		visible: Boolean(input.banner),
		hook: input.banner?.hook,
		href: input.banner ? withClickSurface(input.banner.href, input.clickSurface) : undefined,
		version: input.banner?.version,
		returnTo: input.returnTo,
		cspNonce: input.cspNonce,
		seenScript: Boolean(input.banner),
		clickSurface: input.clickSurface,
	});
}

export const FETCH_CHANGELOG_BANNER_IN_BROWSER = "fetch-in-browser";

const CHANGELOG_BANNER_ENDPOINT = "/blog/changelog-banner";

const CHANGELOG_LOADER_TEMPLATE = `<div class="changelog-banner changelog-banner--hidden" role="status" aria-live="polite" data-test-changelog-banner hx-get="{{url}}" hx-trigger="load" hx-swap="outerHTML"></div>`;

function renderChangelogBannerLoader(input: {
	returnTo?: string;
	clickSurface?: ClickSurface;
}): string {
	const query = new URLSearchParams();
	if (input.returnTo) query.set("returnTo", input.returnTo);
	if (input.clickSurface) query.set("surface", input.clickSurface);
	const search = query.toString();
	return render(CHANGELOG_LOADER_TEMPLATE, {
		url: search ? `${CHANGELOG_BANNER_ENDPOINT}?${search}` : CHANGELOG_BANNER_ENDPOINT,
	});
}

export function renderChangelogBannerSlot(input: {
	banner?: ChangelogBanner | typeof FETCH_CHANGELOG_BANNER_IN_BROWSER;
	returnTo?: string;
	cspNonce: CspNonce;
	clickSurface?: ClickSurface;
}): string {
	if (input.banner === FETCH_CHANGELOG_BANNER_IN_BROWSER) {
		return renderChangelogBannerLoader({ returnTo: input.returnTo, clickSurface: input.clickSurface });
	}
	return renderChangelogBannerShell({ ...input, banner: input.banner });
}
