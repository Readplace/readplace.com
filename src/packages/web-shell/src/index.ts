export { render } from "./render";
export { ANNUAL_PRICE_DISPLAY, MONTHLY_EQUIVALENT_DISPLAY, SUBSCRIBE_CTA_LABEL } from "./pricing";
export { withInternalTracking } from "./internal-link-tracking";
export type { Component, ParsedComponent, SupportedMediaType } from "./component.types";
export type { PageBody, SeoMetadata } from "./page-body.types";
export { HtmlPage } from "./html-page";
export { MarkdownPage } from "./markdown-page";
export { htmlToMarkdown } from "./html-to-markdown";
export { buildMarkdownFrontmatter } from "./markdown-frontmatter";
export type { MarkdownFrontmatterOpts } from "./markdown-frontmatter";
export { MARKDOWN_MEDIA_TYPE, wantsMarkdown } from "./content-negotiation";
export { sendComponent } from "./send-component";
export {
	deriveTrialEscalation,
	formatTrialDisplay,
	formatTrialRemaining,
} from "./trial-countdown.format";
export type {
	TrialDisplay,
	TrialEscalation,
	TrialRemaining,
} from "./trial-countdown.format";
export {
	formatLocalInstant,
	SERVER_TIME_ZONE,
	toAbsoluteDate,
	toAbsoluteDateTime,
	toRelativeOrDate,
	toRelativePhrase,
} from "./local-time.format";
export type {
	LocalTime,
	LocalTimeMode,
	LocalTimeStyle,
} from "./local-time.format";
export {
	bannerStateFromRequest,
	buildGuestNavItems,
	buildNavGroups,
} from "./banner-state";
export type {
	BannerState,
	BannerStateSource,
	NavGroup,
	NavGroupKey,
	NavItem,
	NavItemKey,
} from "./banner-state";
export {
	CHANGELOG_DISMISS_COOKIE_NAME,
	CHANGELOG_SEEN_SCRIPT,
	CHANGELOG_SEEN_STORAGE_KEY,
	CHANGELOG_VERSION_LENGTH,
	isChangelogVersion,
	parseChangelogBannerFragment,
	renderChangelogBannerFragment,
	renderChangelogBannerShell,
} from "./changelog-banner";
/** Cookie parsing is owned by the session package and re-exported here so view-shell
 * consumers can keep importing it from this shell. The dependency is one-way: the
 * session package never depends on this view shell. */
export { readCookie } from "@packages/web-session";
export type { ChangelogBanner, ChangelogVersion } from "./changelog-banner";
export { brandMarkSvg } from "./brand-mark";
export { GlobalNav, GlobalEmptyNav } from "./nav.component";
export type { NavProps } from "./nav.component";
export { initBase } from "./base.component";
export type { BaseConfig, RenderBase, RenderSiteNav } from "./base.component";
export { initChromelessPage } from "./chromeless-page";
export type {
	ChromelessBannerState,
	ChromelessPageConfig,
	RenderChromelessPage,
} from "./chromeless-page";
export { VERIFICATION_CONTACT_EMAIL } from "./shared/verify-banner/verify-banner.component";
export { renderToast } from "./shared/toast/toast.component";
export type { ToastAction, ToastViewModel } from "./shared/toast/toast.component";
export { etagMatches } from "./etag";
export {
	MAX_CAPTURE_POLLS,
	MAX_POLLS,
	MAX_SAVE_SETTLE_POLLS,
	parsePollParam,
} from "./poll-protocol";
export { QuerystringFeatureToggle } from "./feature-toggle";
export type { FeatureToggleSource } from "./feature-toggle";
export { formatTabCountLabel } from "./tab-count-label";
