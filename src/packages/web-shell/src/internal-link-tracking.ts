/**
 * `utm_medium` value stamped on every in-site link and action button. Inlined
 * rather than imported so this shell package takes on no analytics dependency;
 * the analytics middleware that counts internal clicks matches on this same
 * literal, so the two must stay in sync.
 */
const INTERNAL_CLICK_MEDIUM = "internal";

/**
 * `utm_source` is the section a clickable element lives in (`header-nav`,
 * `footer`, `queue`, `home-hero`, …) and `utm_content` is the element itself
 * (`save`, `subscribe`, `mark-read`, …). `utm_medium` is fixed to
 * INTERNAL_CLICK_MEDIUM for every in-site link, and `utm_campaign` is
 * deliberately unused — those two dimensions answer "which button do readers
 * click most, and where".
 *
 * `term` is an optional third dimension mapped to `utm_term`, used where a click
 * carries a per-request attribute worth slicing by (e.g. the reader's device
 * class on the queue's reader-view links). Most links omit it.
 */
interface InternalTracking {
	source: string;
	content: string;
	term?: string;
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
	if (tracking.term) url.searchParams.set("utm_term", tracking.term);
	return `${url.pathname}${url.search}${url.hash}`;
}
