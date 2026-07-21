import { parseHttpUrl } from "@packages/domain/inbox";

const UTM_PREFIX = "utm_";

// Rebuilt from the raw query rather than URLSearchParams: round-tripping through
// the params API re-encodes the survivors (a space comes back as `+`) and would
// hand the reader a different link than the newsletter sent.
export function stripUtmParams(url: string): string {
	const parsed = parseHttpUrl(url);
	if (parsed === undefined) return url;
	const segments = parsed.search.slice(1).split("&");
	const kept = segments.filter((segment) => !segment.split("=")[0].startsWith(UTM_PREFIX));
	if (kept.length === segments.length) return url;
	parsed.search = kept.join("&");
	return parsed.toString();
}
