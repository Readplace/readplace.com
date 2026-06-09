import { INTERNAL_CLICK_SOURCE } from "../observability/events";

/**
 * `utm_medium` is the section a clickable element lives in (`nav`, `footer`,
 * `queue`, `home_hero`, …) and `utm_content` is the element itself (`save`,
 * `subscribe_cta`, `mark_read`, …). `utm_source` is fixed to
 * INTERNAL_CLICK_SOURCE for every in-site link, and `utm_campaign` is
 * deliberately unused — two dimensions are enough to answer "which button do
 * readers click most, and where".
 */
interface InternalTracking {
	medium: string;
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
	if (!href.startsWith("/")) return href;
	const url = new URL(href, PARSE_ORIGIN);
	url.searchParams.set("utm_source", INTERNAL_CLICK_SOURCE);
	url.searchParams.set("utm_medium", tracking.medium);
	url.searchParams.set("utm_content", tracking.content);
	return `${url.pathname}${url.search}${url.hash}`;
}
