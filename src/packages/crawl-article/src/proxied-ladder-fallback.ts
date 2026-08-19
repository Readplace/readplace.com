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
export function withProxiedLadderFallback(deps: {
	directFetch: LadderFetch;
	proxyFetch: LadderFetch;
	reserveMs: number;
	now: () => number;
}): LadderFetch {
	const { directFetch, proxyFetch, reserveMs, now } = deps;
	return async (url, init) => {
		const { budget, headers, onRedirect } = init;
		/* A budget too small to seat a full direct pass plus the reserve runs
		 * direct-only at full budget — that keeps the small thumbnail / oembed /
		 * media crawls on their pre-proxy budget and off metered egress. */
		if (budget.remainingMs() < 2 * reserveMs) {
			return directFetch(url, { headers, onRedirect, budget });
		}
		const directBudget = createCrawlBudget({
			signal: budget.deadline.signal,
			totalMs: budget.remainingMs() - reserveMs,
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
