import { extractUrls } from "../import-session/extract-urls";
import type { ImportLinksResult } from "../import-session/import-session.types";

/** Harvests links from a received message exactly the way file import does —
 * a best-effort `http(s)://` sweep over the decoded body. Anchor `href`s and
 * bare text URLs are both caught; dedup, validation, and the per-message cap
 * are handled by the shared import-link collector. */
export function extractNewsletterLinks(input: {
	html: string;
}): ImportLinksResult {
	return extractUrls(Buffer.from(input.html, "utf8"));
}
