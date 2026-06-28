import type { ChangelogBanner } from "./changelog-banner";
import { withInternalTracking } from "./internal-link-tracking";
import type { TrialDisplay } from "./trial-countdown.format";

/** Presentational standing of an *unverified* account, mirroring TrialDisplay:
 * the consuming site computes it from its own domain and hands it to the shell,
 * which only renders copy. Inlined (rather than imported from the domain) so the
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
	 * truthiness (isAuthenticated) and carries no @packages/domain dependency, so
	 * it deliberately does not reconstruct the domain's branded UserId here — a
	 * domain change must not invalidate the content sites that consume this shell. */
	userId?: string;
	emailVerified?: boolean;
	verificationStatus?: VerificationStatus;
	/** The changelog version the reader has dismissed, lifted from the dismissal
	 * cookie by the consuming site (hutch via cookie-parser middleware). When it
	 * equals the live banner's version the banner is suppressed; a newer post
	 * carries a different version and reappears. */
	dismissedChangelogVersion?: string;
	/** The request's `originalUrl` (path + query). Express populates it on every
	 * request, so a consuming site that passes the request as the source supplies
	 * it structurally; `bannerStateFromRequest` copies it to
	 * `BannerState.currentPath` so the changelog banner's no-JS dismiss form can
	 * post the page the reader is on (the dismiss route cannot rely on `Referer`,
	 * which helmet's default `no-referrer` policy strips). */
	originalUrl?: string;
	/** The request's parsed query string. Express populates it on every request,
	 * so passing the request as the source supplies it structurally;
	 * `bannerStateFromRequest` reads `query.feature` to gate the email-feature
	 * nav entry without the shell importing the host's feature toggle. */
	query?: Record<string, unknown>;
}

export type NavItemKey =
	| "queue"
	| "import"
	| "export"
	| "inbox"
	| "account"
	| "logout"
	| "install"
	| "features"
	| "signup";

/** The querystring feature flag that reveals the email-forwarding surface. The
 * single source of truth for the string, shared so the consuming site's route
 * gate (`featureToggle.isEnabled(req, EMAIL_FEATURE)`) and this shell's nav
 * derivation agree without the shell importing the host's feature toggle. */
export const EMAIL_FEATURE = "email";

/** Logical section a nav item belongs to. The header renders one section per
 * group so related destinations sit together and new destinations slot into an
 * existing group rather than lengthening one flat list. "library" holds the
 * reading queue and its data tools; "account" holds identity/session actions;
 * "explore" is the guest pre-auth section. */
export type NavGroupKey = "library" | "account";

/** Data-driven header nav item. Rendered uniformly as
 * `<form method="{method}" action="{href}"><button>{label}</button></form>`
 * regardless of method — the template never branches on link-vs-form. A
 * `method="GET"` form with no inputs navigates to the action URL on submit,
 * so it behaves exactly like a link; using forms everywhere keeps a single
 * template shape and a single styling target (`.nav__link` already styles
 * `button.nav__link`). Excessive markup is not a performance concern at this
 * scale. The `icon` is a Font Awesome class pair (e.g. "fa-solid fa-inbox")
 * rendered into an empty, `aria-hidden` `<i>` so the glyph reinforces the
 * label without adding text.
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
	icon: string;
	trackSource: string;
	trackContent: string;
	/** Extra query params the entry must deliver to its target, rendered as
	 * hidden inputs beside the UTM trio. A GET submit serializes the form's
	 * fields into the target's query string and discards the action's own query
	 * (the same browser behaviour the UTM dual-transmission above works around),
	 * so these inputs are how NAV_INBOX carries `feature=email` to the
	 * flag-gated /inbox route — without them the gate 404s. Undefined for
	 * entries that need no extra params. */
	hiddenParams?: Record<string, string>;
}

const NAV_SOURCE = "header-nav";

/** Builds a nav item with its href pre-tagged for internal-click tracking and
 * the matching UTM dimensions exposed for the template's hidden inputs. The
 * item `key` doubles as `utm_content` so each destination is distinct. */
function navItem(input: {
	key: NavItemKey;
	label: string;
	path: string;
	method: "GET" | "POST";
	icon: string;
	hiddenParams?: Record<string, string>;
}): NavItem {
	return {
		key: input.key,
		label: input.label,
		href: withInternalTracking(input.path, { source: NAV_SOURCE, content: input.key }),
		method: input.method,
		icon: input.icon,
		trackSource: NAV_SOURCE,
		trackContent: input.key,
		hiddenParams: input.hiddenParams,
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
	 * (subject to its own localStorage dismissal). Defaults to false; the queue
	 * and view page handlers set it when the latest article is not fully parsed. */
	showExtensionSuggestionBanner?: boolean;
	/** Switches the banner copy: when true the message tells the reader to re-save
	 * the article with their already-installed extension; when false (or unset) it
	 * pitches the install. Sourced from the extension liveness cookie. */
	extensionInstalled?: boolean;
	/** Drives the global header pill below the brand. Undefined for guests,
	 * founding members, and paid users; "active" for trialing users;
	 * "cancellation-scheduled" for users inside the cancellation window
	 * (paid + trial); "expired" for users whose trial has lapsed or whose
	 * subscription has finished cancelling. */
	trial?: TrialDisplay;
	/** True when the user's effective access is read-only (trial-expired or
	 * subscription-cancelled). Drives nav-item visibility: import (save flow
	 * is gated server-side) and account (the trial-countdown link in the
	 * header already routes there) are hidden for read-only users. Undefined
	 * for guests and for pages that build the banner state synchronously
	 * (without an access lookup); `buildNavGroups` treats undefined as full
	 * access. */
	accessIsReadOnly?: boolean;
	/** The latest feature announcement to surface site-wide, already filtered
	 * for the reader's dismissal. Undefined when there is nothing to announce or
	 * the reader has dismissed the current one; the shell then renders the
	 * hidden, empty banner shell. */
	changelogBanner?: ChangelogBanner;
	/** Path (+ query) of the page this banner is rendered on, echoed into the
	 * changelog dismiss form's hidden `returnTo` field so dismissing returns the
	 * reader to where they were rather than the homepage. Undefined when the
	 * rendering site supplies no request URL; the dismiss route then falls back
	 * to "/". */
	currentPath?: string;
	/** True when the request carries `?feature=email`. Reveals the Inbox nav
	 * entry; the per-request querystring toggle keeps the surface hidden by
	 * default until the flag is flipped on a request. */
	emailFeatureEnabled?: boolean;
}

const NAV_QUEUE = navItem({ key: "queue", label: "Queue", path: "/queue", method: "GET", icon: "fa-solid fa-inbox" });
const NAV_IMPORT = navItem({ key: "import", label: "Import Links", path: "/import", method: "GET", icon: "fa-solid fa-file-import" });
const NAV_EXPORT = navItem({ key: "export", label: "Export", path: "/export", method: "GET", icon: "fa-solid fa-file-export" });
const NAV_INBOX = navItem({ key: "inbox", label: "Inbox", path: "/inbox", method: "GET", icon: "fa-solid fa-envelope", hiddenParams: { feature: EMAIL_FEATURE } });
const NAV_ACCOUNT = navItem({ key: "account", label: "Account", path: "/account", method: "GET", icon: "fa-solid fa-user" });
const NAV_LOGOUT = navItem({ key: "logout", label: "Sign out", path: "/logout", method: "POST", icon: "fa-solid fa-right-from-bracket" });
const NAV_INSTALL = navItem({ key: "install", label: "Install", path: "/install", method: "GET", icon: "fa-solid fa-download" });
const NAV_FEATURES = navItem({ key: "features", label: "Features", path: "/#what-works", method: "GET", icon: "fa-solid fa-wand-magic-sparkles" });
const NAV_SIGNUP = navItem({ key: "signup", label: "Sign up", path: "/signup", method: "GET", icon: "fa-solid fa-user-plus" });

/** Guest nav items rendered as a flat list without group structure. Import sits
 * before signup so a logged-out visitor can start a migration from the menu; the
 * import flow defers account creation until they commit their selection. */
export function buildGuestNavItems(): NavItem[] {
	return [NAV_INSTALL, NAV_FEATURES, NAV_IMPORT, NAV_SIGNUP];
}

/** Builds the grouped header nav for authenticated users. The template
 * iterates the returned groups (then their items) — no inline conditionals.
 * Adding a destination means pushing a NavItem into the right group here, not
 * editing the template. Item order within a group is preserved so the flat
 * rendered order stays queue → import → export → account → logout. */
export function buildNavGroups(input: {
	accessIsReadOnly: boolean;
	emailFeatureEnabled: boolean;
}): NavGroup[] {
	const library: NavItem[] = [NAV_QUEUE];
	if (!input.accessIsReadOnly) {
		library.push(NAV_IMPORT);
	}
	library.push(NAV_EXPORT);
	// Minting an address is a write action gated by requireWriteAccess, so a
	// read-only user gets no Inbox entry — matching Import, which is hidden the
	// same way. They keep access to existing addresses by direct link.
	if (input.emailFeatureEnabled && !input.accessIsReadOnly) {
		library.push(NAV_INBOX);
	}
	const account: NavItem[] = [];
	if (!input.accessIsReadOnly) {
		account.push(NAV_ACCOUNT);
	}
	account.push(NAV_LOGOUT);
	return [
		{ key: "library", label: "Library", items: library },
		{ key: "account", label: "Account", items: account },
	];
}

export function bannerStateFromRequest(source: BannerStateSource): BannerState {
	return {
		isAuthenticated: Boolean(source.userId),
		emailVerified: source.emailVerified,
		verification: source.verificationStatus,
		currentPath: source.originalUrl,
		emailFeatureEnabled: source.query?.feature === EMAIL_FEATURE,
	};
}
