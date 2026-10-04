import type { IconName } from "@packages/ui-icons";
import type { AppearanceSetting } from "./base.styles";
import type { ChangelogBanner, FETCH_CHANGELOG_BANNER_IN_BROWSER } from "./changelog-banner";
import { type CspNonce, requireCspNonce } from "./csp-nonce.middleware";
import { QuerystringFeatureToggle } from "./feature-toggle";
import { type ClickSurface, withInternalTracking } from "./internal-link-tracking";

/** Presentational standing of an *unverified* account: the consuming site
 * computes it from its own domain and hands it to the shell, which only
 * renders copy. Inlined (rather than imported from the domain) so the
 * shell stays dependency-free — any structurally identical status from elsewhere
 * assigns without a cast. Verified users and guests carry none; `pending` is the
 * legacy fallback (no anchor, so no countdown and no lockout). File-private: the
 * shell consumes it only through BannerStateSource/BannerState, and callers pass
 * a structurally identical value rather than importing this name. */
type VerificationStatus =
	| { state: "pending" }
	| { state: "counting-down"; daysLeft: number }
	| { state: "locked" };

export interface BannerStateSource {
	/** The authenticated user's id as a plain string. The shell reads it only for
	 * truthiness (isAuthenticated) and carries no domain-layer dependency, so
	 * it deliberately does not reconstruct the domain's branded UserId here — a
	 * domain change must not invalidate the content sites that consume this shell. */
	userId?: string;
	emailVerified?: boolean;
	verificationStatus?: VerificationStatus;
	/** The request's `originalUrl` (path + query). Express populates it on every
	 * request, so a consuming site that passes the request as the source supplies
	 * it structurally; `bannerStateFromRequest` copies it to
	 * `BannerState.currentPath` so the changelog banner's no-JS dismiss form can
	 * post the page the reader is on (the dismiss route cannot rely on `Referer`,
	 * which helmet's default `no-referrer` policy strips). */
	originalUrl?: string;
	/** The request's parsed query string. Express populates it on every request,
	 * so a consuming site that passes the request as the source supplies it
	 * structurally. Read only through {@link QuerystringFeatureToggle} to decide
	 * whether an unreleased destination is discoverable on this request. */
	query?: Record<string, unknown>;
	/** Markup the consuming site computed for *this request alone*, appended to
	 * the page's scripts. `BaseConfig.siteScripts` cannot express it: that string
	 * is bound once at `initBase` and is therefore the same on every render. A
	 * site that computes none — the blog — never sets it and renders unchanged. */
	requestScripts?: string;
	/** The nonce `createCspNonceMiddleware` stamped on this request, which every
	 * inline script and style the shell emits carries. Optional here only because
	 * that is the strongest shape Express declaration merging allows; the shell
	 * requires it. */
	cspNonce?: CspNonce;
}

export type NavItemKey =
	| "queue"
	| "import"
	| "inbox"
	| "integrations"
	| "account"
	| "blog"
	| "privacy"
	| "terms"
	| "logout"
	| "install"
	| "features"
	| "login";

/** Logical section a nav item belongs to. The header renders one section per
 * group so related destinations sit together and new destinations slot into an
 * existing group rather than lengthening one flat list. "library" holds the
 * reading surfaces; "account" holds identity/session actions. */
export type NavGroupKey = "library" | "account";

/** Data-driven header nav item. Rendered uniformly as
 * `<form method="{method}" action="{href}"><button>{label}</button></form>`
 * regardless of method — the template never branches on link-vs-form. A
 * `method="GET"` form with no inputs navigates to the action URL on submit,
 * so it behaves exactly like a link; using forms everywhere keeps a single
 * template shape and a single styling target. Excessive markup is not a
 * performance concern at this scale. The `iconName` is a name from the shared set, not markup: the template
 * resolves it through `{{icon}}`, so this module stays free of drawing detail
 * and a redraw of an icon never touches nav data. The glyph is decoration beside
 * the visible label, so it adds nothing to the accessible name.
 *
 * `trackSource`/`trackContent` carry the internal-click UTM dimensions. The
 * template renders them as hidden inputs AND `href` is pre-tagged via
 * withInternalTracking, because the two form methods transmit query params
 * differently: a GET submit replaces the action's query with the serialized
 * fields (so the hidden inputs carry the UTM), while a POST keeps the action's
 * query (so the tagged `href` carries it). Rendering both keeps every item
 * tracked under one uniform form shape. */
export interface NavItem {
	key: NavItemKey;
	label: string;
	href: string;
	method: "GET" | "POST";
	iconName: IconName;
	linkClass: string;
	trackSource: string;
	trackContent: string;
	trackTerm?: ClickSurface;
}

const NAV_SOURCE = "header-nav";

const NAV_LINK_CLASS = "nav__link";

const GMAIL_FEATURE = "gmail";

const featureToggle = new QuerystringFeatureToggle();

/** Builds a nav item with its href pre-tagged for internal-click tracking and
 * the matching UTM dimensions exposed for the template's hidden inputs. The
 * item `key` doubles as `utm_content` so each destination is distinct. */
function navItem(input: {
	key: NavItemKey;
	label: string;
	path: string;
	method: "GET" | "POST";
	iconName: IconName;
}): NavItem {
	return {
		key: input.key,
		label: input.label,
		href: withInternalTracking(input.path, { source: NAV_SOURCE, content: input.key }),
		method: input.method,
		iconName: input.iconName,
		linkClass: NAV_LINK_CLASS,
		trackSource: NAV_SOURCE,
		trackContent: input.key,
	};
}

/** A labelled section of the header nav. The template iterates groups, then the
 * items within each — no inline conditionals. Adding or moving a destination is
 * an edit to `buildNavGroups`, not to the template. */
export interface NavGroup {
	key: NavGroupKey;
	label: string;
	items: NavItem[];
}

export interface BannerState {
	isAuthenticated: boolean;
	emailVerified: boolean | undefined;
	/** Verification standing of an unverified account. Undefined for verified
	 * users and guests; the verify banner reads it to switch between the
	 * countdown copy and the locked-out contact-support copy. */
	verification?: VerificationStatus;
	/** When true, the SSR markup carries data-show-extension-suggestion="true"
	 * so the banner client can reveal the dismissible extension-suggestion banner
	 * (subject to its own localStorage dismissal). Defaults to false; the readlist
	 * and view page handlers set it when the latest article is not fully parsed. */
	showExtensionSuggestionBanner?: boolean;
	/** Switches the banner copy: when true the message tells the reader to re-save
	 * the article with their already-installed extension; when false (or unset) it
	 * pitches the install. Sourced from the extension liveness cookie. */
	extensionInstalled?: boolean;
	/** True when the user's effective access is read-only (trial-expired or
	 * subscription-cancelled). Undefined for guests and for pages that build
	 * the banner state synchronously (without an access lookup);
	 * `buildNavGroups` treats undefined as full access. */
	accessIsReadOnly?: boolean;
	userEmail?: string;
	/** The latest feature announcement to surface site-wide. */
	changelogBanner?: ChangelogBanner | typeof FETCH_CHANGELOG_BANNER_IN_BROWSER;
	/** Path (+ query) of the page this banner is rendered on, echoed into the
	 * changelog dismiss form's hidden `returnTo` field so dismissing returns the
	 * reader to where they were rather than the homepage. Undefined when the
	 * rendering site supplies no request URL; the dismiss route then falls back
	 * to "/". */
	currentPath?: string;
	/** Per-request script markup carried through from `BannerStateSource`. */
	requestScripts?: string;
	gmailFeatureEnabled?: boolean;
	appearance?: AppearanceSetting;
	cspNonce: CspNonce;
}

const NAV_READLIST = navItem({ key: "queue", label: "Readlist", path: "/queue", method: "GET", iconName: "book" });
const NAV_IMPORT = navItem({ key: "import", label: "Import Links", path: "/import", method: "GET", iconName: "file-down" });
const NAV_INBOX = navItem({ key: "inbox", label: "Inbox", path: "/inbox", method: "GET", iconName: "inbox" });
const NAV_INTEGRATIONS = navItem({
	key: "integrations",
	label: "Integrations",
	path: "/newsletters",
	method: "GET",
	iconName: "plug",
});

const NAV_ACCOUNT = navItem({ key: "account", label: "Account", path: "/account", method: "GET", iconName: "user" });
const NAV_BLOG = navItem({ key: "blog", label: "Blog", path: "/blog", method: "GET", iconName: "note" });
const NAV_PRIVACY = navItem({ key: "privacy", label: "Privacy", path: "/privacy", method: "GET", iconName: "file" });
const NAV_TERMS = navItem({ key: "terms", label: "Terms", path: "/terms", method: "GET", iconName: "file" });
const NAV_LOGOUT = navItem({ key: "logout", label: "Sign out", path: "/logout", method: "POST", iconName: "log-out" });
const NAV_INSTALL = navItem({ key: "install", label: "Install", path: "/install", method: "GET", iconName: "download" });
const NAV_FEATURES = navItem({ key: "features", label: "Features", path: "/#ways-to-save", method: "GET", iconName: "sparkles" });
const NAV_LOGIN: NavItem = {
	...navItem({ key: "login", label: "Log in", path: "/login", method: "GET", iconName: "log-in" }),
	linkClass: `${NAV_LINK_CLASS} btn btn--primary btn--m`,
};

/** Import sits before the login entry so a logged-out visitor can start a
 * migration from the menu; the import flow defers account creation until they
 * commit their selection. */
export function buildGuestNavGroups(): NavGroup[] {
	return [
		{ key: "library", label: "Library", items: [NAV_INSTALL, NAV_IMPORT, NAV_FEATURES] },
		{ key: "account", label: "Account", items: [NAV_LOGIN] },
	];
}

/** Builds the grouped header nav for authenticated users. The template
 * iterates the returned groups (then their items) — no inline conditionals.
 * Adding a destination means pushing a NavItem into the right group here, not
 * editing the template.
 * Export is deliberately absent: it lives on the account page instead. */
export function buildNavGroups(input: {
	accessIsReadOnly: boolean;
	gmailFeatureEnabled: boolean;
}): NavGroup[] {
	const library: NavItem[] = [NAV_READLIST];
	// Saving and minting an address are write actions gated by requireWriteAccess,
	// so a read-only user gets neither entry. They keep access to existing
	// addresses by direct link.
	if (!input.accessIsReadOnly) {
		library.push(NAV_IMPORT, NAV_INBOX);
	}
	if (input.gmailFeatureEnabled) library.push(NAV_INTEGRATIONS);
	return [
		{ key: "library", label: "Library", items: library },
		{ key: "account", label: "Account", items: [NAV_ACCOUNT, NAV_BLOG, NAV_PRIVACY, NAV_TERMS, NAV_LOGOUT] },
	];
}

export function bannerStateFromRequest(source: BannerStateSource): BannerState {
	return {
		isAuthenticated: Boolean(source.userId),
		emailVerified: source.emailVerified,
		verification: source.verificationStatus,
		currentPath: source.originalUrl,
		requestScripts: source.requestScripts,
		gmailFeatureEnabled: featureToggle.isEnabled({ query: source.query ?? {} }, GMAIL_FEATURE),
		cspNonce: requireCspNonce(source),
	};
}
