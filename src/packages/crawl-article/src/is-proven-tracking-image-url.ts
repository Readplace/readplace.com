const EXACT_TRACKING_PATHS: ReadonlyMap<string, string> = new Map([
	["www.facebook.com", "/tr"],
	["hspx.hotstar.com", "/v1/events/track/cp_page_view"],
]);
const AKAMAI_PIXEL_HOSTS: ReadonlySet<string> = new Set(["www.sec.gov", "www.turkishairlines.com"]);
const AKAMAI_PIXEL_PATH = /^\/akam\/13\/pixel_[0-9a-f]{8}$/;

export function isProvenTrackingImageUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
	if (parsed.port !== "") return false;
	const { hostname, pathname } = parsed;
	if (EXACT_TRACKING_PATHS.get(hostname) === pathname) return true;
	return AKAMAI_PIXEL_HOSTS.has(hostname) && AKAMAI_PIXEL_PATH.test(pathname);
}
