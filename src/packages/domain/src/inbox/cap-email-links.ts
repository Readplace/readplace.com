import type { ImportLinksResult } from "../import-session";

export const INBOX_MAX_LINKS_PER_EMAIL = 300;

/** Preserve the upstream truncation signal when limiting an email's URLs. */
export function capEmailLinks(
	result: ImportLinksResult,
	options: { maxLinks: number },
): { urls: string[]; truncated: boolean } {
	const truncated = result.truncated || result.urls.length > options.maxLinks;
	return { urls: result.urls.slice(0, options.maxLinks), truncated };
}
