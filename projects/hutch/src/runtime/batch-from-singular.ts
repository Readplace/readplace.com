/** Derives a batched read from a single-article read by looping it, keyed by the
 * url as given. The in-memory dev/test providers only expose the singular
 * contract, so the queue's batched loadSummaries/loadCrawls are fed a loop over
 * it: one read per url, matching both the production DynamoDB batch's per-url
 * result shape and the read count the singular path produced (which the
 * summary-poll fake depends on to transition pending -> ready). Production wires
 * the real BatchGet instead; this is only for the in-memory composition roots. */
export function batchFromSingular<T>(
	singular: (url: string) => Promise<T>,
): (urls: readonly string[]) => Promise<ReadonlyMap<string, T>> {
	return async (urls) =>
		new Map(
			await Promise.all(urls.map(async (url) => [url, await singular(url)] as const)),
		);
}
