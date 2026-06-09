import { INTERNAL_CLICK_MEDIUM } from "../observability/events";

/**
 * `utm_source` is the section a clickable element lives in (`header-nav`,
 * `footer`, `queue`, `home-hero`, …) and `utm_content` is the element itself
 * (`save`, `subscribe`, `mark-read`, …). `utm_medium` is fixed to
 * INTERNAL_CLICK_MEDIUM for every in-site link, and `utm_campaign` is
 * deliberately unused — two dimensions are enough to answer "which button do
 * readers click most, and where".
 */
interface InternalTracking {
	source: string;
	content: string;
}

/**
 * Origin for parsing root-relative hrefs. `.invalid` is reserved by RFC 2606 so
 * it can never resolve, and we only read back `pathname`/`search`/`hash` — the
 * host is discarded.
 */
const PARSE_ORIGIN = "https://internal.invalid";

/**
 * Appends the internal-click UTM params to a root-relative href. Absolute and
 * protocol-relative hrefs are returned untouched: tagging an external
 * destination would leak our analytics params to another site and the click
 * isn't ours to count. Using URLSearchParams.set makes the call idempotent and
 * correct whether or not the href already has a query string.
 */
export function withInternalTracking(href: string, tracking: InternalTracking): string {
	if (!href.startsWith("/") || href.startsWith("//")) return href;
	const url = new URL(href, PARSE_ORIGIN);
	url.searchParams.set("utm_source", tracking.source);
	url.searchParams.set("utm_medium", INTERNAL_CLICK_MEDIUM);
	url.searchParams.set("utm_content", tracking.content);
	return `${url.pathname}${url.search}${url.hash}`;
}
