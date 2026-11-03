import type { CrawlFetch } from "./crawl-fetch";
import { ALLOWED_PROTOCOLS } from "./meta-refresh";

const UNLOCKER_FINAL_URL_HEADER = "x-unblocker-redirected-to";

export type UnlockerNavigation = { kind: "navigated"; url: string; status: number } | { kind: "not-navigated"; status: number };

export type ResolveThroughUnlocker = (
	url: string,
	init: { signal: AbortSignal; budgetMs: number },
) => Promise<UnlockerNavigation>;

export function initResolveThroughUnlocker(deps: {
	crawlFetch: CrawlFetch;
	headers: Record<string, string>;
}): ResolveThroughUnlocker {
	return async (url, init) => {
		const response = await deps.crawlFetch(url, { headers: deps.headers, budgetMs: init.budgetMs, signal: init.signal });
		await response.body?.cancel();
		const target = URL.parse(response.headers.get(UNLOCKER_FINAL_URL_HEADER) ?? "");
		if (target === null || !ALLOWED_PROTOCOLS.has(target.protocol)) return { kind: "not-navigated", status: response.status };
		return { kind: "navigated", url: target.href, status: response.status };
	};
}
