import type { ImportLinksResult } from "../import-session";

/** Apply a per-email soft cap on top of the 2,000 URL hard cap already enforced
 * by `extractUrls`/`collectImportLinks`. The soft cap bounds the per-email crawl
 * fan-out (≤ `maxLinks` preview commands per email) while staying far under the
 * hard cap. `truncated` is sticky: true if EITHER cap was hit, so a downstream
 * "showing first N of many" notice fires for both reasons. */
export function capEmailLinks(
	result: ImportLinksResult,
	options: { maxLinks: number },
): { urls: string[]; truncated: boolean } {
	const truncated = result.truncated || result.urls.length > options.maxLinks;
	return { urls: result.urls.slice(0, options.maxLinks), truncated };
}
