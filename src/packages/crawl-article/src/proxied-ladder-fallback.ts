import { callerHasGivenUp, createCrawlBudget } from "./crawl-budget";
import { isBlockClassError, isBlockClassResponse } from "./persona-fallback";
import type { LadderFetch } from "./transport-ladder";

/**
 * Run the whole direct-egress ladder first and, only when it ends blocked or
 * starved, run the same ladder again through the residential proxy. Direct
 * Lambda egress is free; proxy egress is metered, so the proxied pass runs
 * strictly after the direct pass, and only for a budget large enough to seat
 * both — the direct pass keeps a full pass and the proxied pass its reserve.
 *
 * A proxied answer is returned whatever its status (a residential 404 means the
 * page is genuinely gone — better information than the datacenter block); a
 * proxied transport failure surfaces the direct outcome instead.
 */
/* The direct pass is never shortened below this: it is the free path and it
 * answers the overwhelming majority of URLs. */
const DIRECT_PASS_FLOOR_MILLISECONDS = 15_000;
/* Below this the proxied pass cannot seat even a median unlocker fetch, so
 * spending metered egress on it would only buy a timeout. */
const PROXY_ATTEMPT_FLOOR_MILLISECONDS = 12_000;

export function withProxiedLadderFallback(deps: {
	directFetch: LadderFetch;
	proxyFetch: LadderFetch;
	proxyReserveMilliseconds: number;
	now: () => number;
}): LadderFetch {
	const { directFetch, proxyFetch, proxyReserveMilliseconds, now } = deps;
	return async (url, init) => {
		const { budget, headers, onRedirect } = init;
		/* Carve the reserve out of what is left after the direct pass keeps its
		 * floor, then run direct-only when what remains cannot seat a useful
		 * proxied attempt — which is what keeps the small thumbnail / oembed /
		 * media crawls on their pre-proxy budget and off metered egress. */
		const reserve = Math.min(proxyReserveMilliseconds, budget.remainingMs() - DIRECT_PASS_FLOOR_MILLISECONDS);
		if (reserve < PROXY_ATTEMPT_FLOOR_MILLISECONDS) {
			return directFetch(url, { headers, onRedirect, budget });
		}
		const directBudget = createCrawlBudget({
			signal: budget.deadline.signal,
			totalMs: budget.remainingMs() - reserve,
			now,
		});
		let directOutcome: { response: Response } | { thrown: unknown };
		try {
			const response = await directFetch(url, { headers, onRedirect, budget: directBudget });
			if (!isProxyWorthyResponse(response)) return response;
			directOutcome = { response };
		} catch (error) {
			if (!isProxyWorthyError(error)) throw error;
			directOutcome = { thrown: error };
		}
		if (callerHasGivenUp(budget.deadline)) return surface(directOutcome);
		const proxyBudget = createCrawlBudget({
			signal: budget.deadline.signal,
			totalMs: budget.remainingMs(),
			now,
		});
		try {
			return await proxyFetch(url, { headers, onRedirect, budget: proxyBudget });
		} catch {
			return surface(directOutcome);
		}
	};
}

function surface(directOutcome: { response: Response } | { thrown: unknown }): Response {
	if ("response" in directOutcome) return directOutcome.response;
	throw directOutcome.thrown;
}

function isProxyWorthyResponse(response: Response): boolean {
	return isBlockClassResponse(response) || response.status === 429;
}

function isProxyWorthyError(error: unknown): boolean {
	if (isBlockClassError(error)) return true;
	return error instanceof Error && error.name === "TimeoutError";
}
