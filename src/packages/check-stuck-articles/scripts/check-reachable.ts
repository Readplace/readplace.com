/**
 * Reachability filter for the stuck-articles canary.
 *
 * "Reachable" here means a basic HEAD probe receives any HTTP response. We do
 * not care about status codes — a 200, 404 or 503 all prove an origin server
 * answered, so the row stays in the canary report (the operator may still need
 * to ship a fix). "Unreachable" is reserved for the cases where `fetch()`
 * throws: DNS failure, TCP refused, TLS handshake error, timeout. Those rows
 * are not actionable and we drop them so the canary stops alarming on
 * `cd.home.arpa` and similar dead URLs.
 *
 * Native fetch only — no Cloudflare TLS-bypass chain. A site that blocks
 * native fetch but clears the crawler chain is one the prod crawler is
 * already reaching, so it would not be stuck in the first place.
 */

interface ReachableDeps {
	fetch: typeof fetch;
	timeoutMs: number;
	log: (msg: string) => void;
}

export async function isReachable(
	url: string,
	deps: Pick<ReachableDeps, "fetch" | "timeoutMs">,
): Promise<boolean> {
	try {
		await deps.fetch(url, {
			method: "HEAD",
			signal: AbortSignal.timeout(deps.timeoutMs),
			redirect: "follow",
		});
		return true;
	} catch {
		return false;
	}
}

export async function filterReachable<T extends { originalUrl: string }>(
	rows: T[],
	deps: ReachableDeps & { concurrency: number; skipProbe: (row: T) => boolean },
): Promise<T[]> {
	const reachable: T[] = [];
	for (let i = 0; i < rows.length; i += deps.concurrency) {
		const chunk = rows.slice(i, i + deps.concurrency);
		const results = await Promise.all(
			chunk.map(async (row) => ({
				row,
				ok: deps.skipProbe(row) || (await isReachable(row.originalUrl, deps)),
			})),
		);
		for (const { row, ok } of results) {
			if (ok) reachable.push(row);
		}
	}
	const excluded = rows.length - reachable.length;
	if (excluded > 0) {
		deps.log(`[info] excluded ${excluded} row(s) as unreachable`);
	}
	return reachable;
}
