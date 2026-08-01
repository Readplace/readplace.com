import { type CrawlFailureReason, CrawlFailureReasonSchema } from "./crawl-failure-reason";

/* The crawl-failure reason crosses a storage boundary as `JSON.stringify(reason)`.
 * Legacy rows whose reason is a bare (non-JSON) string or a kind/cause this
 * build no longer knows parse to `undefined`, so a caller degrades to its
 * generic copy instead of crashing on a shape it cannot render. */
export function parseCrawlFailureReason(
	rawReason: string | undefined,
): CrawlFailureReason | undefined {
	if (rawReason === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawReason);
	} catch {
		return undefined;
	}
	const result = CrawlFailureReasonSchema.safeParse(parsed);
	if (!result.success) return undefined;
	return result.data;
}
