export { render } from "./render";
export { ANNUAL_PRICE_DISPLAY } from "./pricing";
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
	toAbsoluteDate,
	toAbsoluteDateTime,
	toRelativeOrDate,
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
	EMAIL_FEATURE,
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
/** Re-exported from @packages/web-session (its home, since cookie parsing is now
 * shared with the session-cookie reader) so existing web-shell consumers keep
 * importing it from here. web-shell → web-session is one-way: the auth package
 * never depends on this view shell. */
export { readCookie } from "@packages/web-session";
export type { ChangelogBanner, ChangelogVersion } from "./changelog-banner";
export { Nav } from "./nav.component";
export type { NavProps } from "./nav.component";
export { initBase } from "./base.component";
export type { BaseConfig, RenderBase } from "./base.component";
export { VERIFICATION_CONTACT_EMAIL } from "./shared/verify-banner/verify-banner.component";
