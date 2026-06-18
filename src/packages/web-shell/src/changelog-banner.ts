import assert from "node:assert";
import { parseHTML } from "linkedom";
import { render } from "./render";

/** A single site-wide feature announcement. `hook` is the human-facing
 * one-liner, `href` the root-relative link to the announcing blog post (already
 * UTM-tagged by the producer), and `version` an opaque 8-hex-char fingerprint of
 * the post that drives dismissal: the close button posts it back, the cookie
 * stores it, and both deployables compare it byte-for-byte. The version is
 * produced only by blog-site and echoed through the fragment — no other code
 * re-hashes it, so a reader's dismissal always matches the banner they saw. */
export interface ChangelogBanner {
	hook: string;
	href: string;
	version: string;
}

/** Shared by both deployables: hutch reads it via cookie-parser, blog-site via
 * the raw header. path:"/" + the readplace.com origin make it readable by both
 * Lambdas, so dismissing on /blog also dismisses on the app and vice versa. */
export const CHANGELOG_DISMISS_COOKIE_NAME = "rp_changelog_dismissed";

const VERSION_PATTERN = /^[0-9a-f]{8}$/;

/** The transport contract between blog-site (producer) and hutch (consumer):
 * minimal HTML that survives a fetch + parse round-trip. Handlebars escapes the
 * hook and href; linkedom decodes them back, so the values reconstruct exactly.
 * Data attributes (not BEM classes) carry the machine-read fields because this
 * fragment is never styled — it exists only to be parsed. */
const CHANGELOG_FRAGMENT_TEMPLATE = `<div data-changelog-version="{{version}}"><span data-changelog-hook>{{hook}}</span><a data-changelog-link href="{{href}}">Read more</a></div>`;

export function renderChangelogBannerFragment(banner: ChangelogBanner): string {
	return render(CHANGELOG_FRAGMENT_TEMPLATE, banner);
}

/** Reconstructs a ChangelogBanner from a fetched fragment. linkedom (not a
 * regex) so malformed input degrades to undefined rather than mis-parsing. Every
 * field is re-validated against the contract — version shape and root-relative
 * href — because the bytes crossed a network boundary; any miss yields undefined
 * so the caller simply renders no banner. */
export function parseChangelogBannerFragment(html: string): ChangelogBanner | undefined {
	const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
	const root = document.querySelector("body > *");
	if (!root) return undefined;

	const version = root.getAttribute("data-changelog-version");
	if (!version || !VERSION_PATTERN.test(version)) return undefined;

	const hookEl = root.querySelector("[data-changelog-hook]");
	if (!hookEl) return undefined;
	const hook = hookEl.textContent;
	assert(hook !== null, "an element's textContent is never null");

	const link = root.querySelector("a");
	if (!link) return undefined;
	const href = link.getAttribute("href");
	if (href === null) return undefined;
	if (!href.startsWith("/") || href.startsWith("//")) return undefined;

	return { hook, href, version };
}

/** The visible banner, rendered identically by both deployables through the
 * shell. Always emits the `.changelog-banner` element — `--visible` with content
 * when a banner is present, `--hidden` and empty otherwise — so the markup is
 * stable for tests and SSR (no client JS decides visibility). The close control
 * is a no-JS POST form carrying the rendered version, so the dismissal records
 * exactly the announcement the reader saw. */
const CHANGELOG_SHELL_TEMPLATE = `<div class="changelog-banner {{#if visible}}changelog-banner--visible{{else}}changelog-banner--hidden{{/if}}" role="status" aria-live="polite" data-test-changelog-banner>{{#if visible}}<div class="changelog-banner__inner"><span class="changelog-banner__chip" aria-hidden="true">NEW</span><span class="changelog-banner__hook">{{hook}}</span><a class="changelog-banner__link" href="{{href}}">Read more <span class="changelog-banner__arrow" aria-hidden="true">&rarr;</span></a><form class="changelog-banner__dismiss" method="POST" action="/banner/changelog/dismiss"><input type="hidden" name="version" value="{{version}}"><button type="submit" class="changelog-banner__close" aria-label="Dismiss changelog banner"><span aria-hidden="true">&times;</span></button></form></div>{{/if}}</div>`;

export function renderChangelogBannerShell(banner?: ChangelogBanner): string {
	return render(CHANGELOG_SHELL_TEMPLATE, {
		visible: Boolean(banner),
		hook: banner?.hook,
		href: banner?.href,
		version: banner?.version,
	});
}

/** Pure reader for a single cookie out of a raw `Cookie:` header. Lets blog-site
 * check the dismissal cookie without taking a cookie-parser dependency — it
 * stays stateless and reads one header. hutch uses cookie-parser instead, but
 * shares this so both deployables agree on the cookie name. A value that is not
 * a valid percent-escape (e.g. an attacker-sent `rp_changelog_dismissed=%`)
 * decodes to its raw substring rather than throwing — mirroring cookie-parser's
 * tryDecode, so both deployables read the same malformed cookie identically and
 * this decorative banner's cookie read can never 500 a page (the raw value just
 * fails the byte-for-byte version match and the banner stays visible). */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
	if (!cookieHeader) return undefined;
	for (const cookie of cookieHeader.split(";")) {
		const [key, ...rest] = cookie.trim().split("=");
		if (key === name) {
			const raw = rest.join("=");
			try {
				return decodeURIComponent(raw);
			} catch {
				return raw;
			}
		}
	}
	return undefined;
}
