import assert from "node:assert";
import { parseHTML } from "linkedom";
import { render } from "./render";

/** An opaque lowercase-hex fingerprint of the announcing post (`CHANGELOG_VERSION_LENGTH`
 * chars), branded so its shape is single-sourced across the deploy boundary. The
 * only way to obtain one is `isChangelogVersion`, so the producer (blog-site), the
 * fragment parser here, and hutch's dismiss route cannot drift to different notions
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
 * crossed a boundary — a fetched fragment's attribute, a posted form field, a
 * freshly hashed slug — is checked here once; callers narrow to the brand through
 * this predicate instead of re-testing the shape, so the version contract has a
 * single definition the compiler keeps every call site honest about. */
export function isChangelogVersion(value: unknown): value is ChangelogVersion {
	return typeof value === "string" && VERSION_PATTERN.test(value);
}

/** A single site-wide feature announcement. `hook` is the human-facing
 * one-liner, `href` the root-relative link to the announcing blog post (already
 * UTM-tagged by the producer), and `version` an opaque fingerprint of the post
 * that drives dismissal: the close button posts it back, the cookie stores it,
 * and both deployables compare it byte-for-byte. The version is produced only by
 * blog-site and echoed through the fragment — no other code re-hashes it, so a
 * reader's dismissal always matches the banner they saw. */
export interface ChangelogBanner {
	hook: string;
	href: string;
	version: ChangelogVersion;
}

/** Shared by both deployables: hutch reads it via cookie-parser, blog-site via
 * the raw header. path:"/" + the readplace.com origin make it readable by both
 * Lambdas, so dismissing on /blog also dismisses on the app and vice versa. */
export const CHANGELOG_DISMISS_COOKIE_NAME = "rp_changelog_dismissed";

/** The transport contract between blog-site (producer) and hutch (consumer):
 * minimal HTML that survives a fetch + parse round-trip. Handlebars escapes the
 * hook and href; linkedom decodes them back, so the values reconstruct exactly.
 * Data attributes mark the version and hook (BEM classes are for the styled
 * shell, never this); the link is the fragment's only `<a>`, so the parser finds
 * it by tag. This fragment is never styled — it exists only to be parsed. */
const CHANGELOG_FRAGMENT_TEMPLATE = `<div data-changelog-version="{{version}}"><span data-changelog-hook>{{hook}}</span><a href="{{href}}">Read more</a></div>`;

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
	if (!isChangelogVersion(version)) return undefined;

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

/** The single localStorage key recording the last banner version this browser
 * has seen. One key (not one-per-version) so a newer post overwrites the old
 * value and the entry never grows unbounded. Shared by the inline seen-script
 * and its test, single-sourced here so they cannot drift. */
export const CHANGELOG_SEEN_STORAGE_KEY = "readplace.changelog-seen";

/** Runs synchronously before paint as the visible banner's last child, so an
 * already-seen banner never flashes its NEW chip. It reads the version off the
 * banner's data attribute — never interpolated into this JS, so the script is a
 * static string with no injection surface — and toggles `--seen` (which hides
 * the chip via CSS) the moment this browser has already seen that version. The
 * first sight of a version records it, so reloads of the same announcement drop
 * NEW while a newer post re-lights it. Dismissal is unaffected: the server
 * suppresses the whole banner for a dismissed version regardless of this key.
 * Storage access is guarded so private-mode throws leave NEW visible (no-JS and
 * storage-blocked browsers keep today's always-NEW behaviour). */
export const CHANGELOG_SEEN_SCRIPT = `(function(){var banner=document.querySelector('.changelog-banner[data-changelog-version]');if(!banner)return;var version=banner.getAttribute('data-changelog-version');try{if(localStorage.getItem('${CHANGELOG_SEEN_STORAGE_KEY}')===version){banner.classList.add('changelog-banner--seen');}else{localStorage.setItem('${CHANGELOG_SEEN_STORAGE_KEY}',version);}}catch(e){}})();`;

/** The visible banner, rendered identically by both deployables through the
 * shell. Always emits the `.changelog-banner` element — `--visible` with content
 * when a banner is present, `--hidden` and empty otherwise — so the markup is
 * stable for tests and SSR (no client JS decides visibility). The close control
 * is a no-JS POST form carrying the rendered version (so the dismissal records
 * exactly the announcement the reader saw) and the page's own path as `returnTo`
 * (so the dismiss route sends the reader back where they were rather than the
 * homepage — it cannot read `Referer`, which helmet's default `no-referrer`
 * policy strips from the POST). The visible branch also carries the version as a
 * data attribute and a trailing inline script that turns the always-rendered NEW
 * chip into an unseen-only signal per browser (CHANGELOG_SEEN_SCRIPT). */
const CHANGELOG_SHELL_TEMPLATE = `<div class="changelog-banner {{#if visible}}changelog-banner--visible{{else}}changelog-banner--hidden{{/if}}" role="status" aria-live="polite" data-test-changelog-banner{{#if visible}} data-changelog-version="{{version}}"{{/if}}>{{#if visible}}<div class="changelog-banner__inner"><span class="changelog-banner__chip" aria-hidden="true">NEW</span><span class="changelog-banner__hook">{{hook}}</span><a class="changelog-banner__link" href="{{href}}">Read more <span class="changelog-banner__arrow" aria-hidden="true">&rarr;</span></a><form class="changelog-banner__dismiss" method="POST" action="/banner/changelog/dismiss"><input type="hidden" name="version" value="{{version}}"><input type="hidden" name="returnTo" value="{{returnTo}}"><button type="submit" class="changelog-banner__close" aria-label="Dismiss changelog banner"><span aria-hidden="true">&times;</span></button></form></div><script>${CHANGELOG_SEEN_SCRIPT}</script>{{/if}}</div>`;

export function renderChangelogBannerShell(banner?: ChangelogBanner, returnTo?: string): string {
	return render(CHANGELOG_SHELL_TEMPLATE, {
		visible: Boolean(banner),
		hook: banner?.hook,
		href: banner?.href,
		version: banner?.version,
		returnTo,
	});
}
