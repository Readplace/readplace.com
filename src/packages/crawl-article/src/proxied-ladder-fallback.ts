import { callerHasGivenUp, createCrawlBudget } from "./crawl-budget";
import type { OnRedirect } from "./follow-redirects";
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
 * page is genuinely gone — better information than the datacenter block), with
 * one exception: a gateway status is the proxy failing rather than answering
 * about the document, so it is retried once and otherwise never leaves this
 * wrapper.
 */
/* The direct pass is never shortened below this: it is the free path and it
 * answers the overwhelming majority of URLs. */
const DIRECT_PASS_FLOOR_MILLISECONDS = 15_000;
/* Below this the proxied pass cannot seat even a median unlocker fetch, so
 * spending metered egress on it would only buy a timeout. */
const PROXY_ATTEMPT_FLOOR_MILLISECONDS = 12_000;
/* Statuses the unlocker returns when it, rather than the origin, failed:
 * measured on one URL, five sequential fetches answered 200, 502, 502, 200,
 * 200. 500 is excluded — that one is plausibly the origin's own answer, which
 * the caller is entitled to receive. */
const PROXY_GATEWAY_STATUSES = new Set([502, 503, 504]);
const PROXY_ATTEMPTS = 2;

type DirectOutcome = { response: Response } | { thrown: unknown };

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
		let lastDirectHopTarget: string | undefined;
		const captureDirectHop: OnRedirect = (hop) => {
			lastDirectHopTarget = hop.toUrl;
			onRedirect?.(hop);
		};
		const directBudget = createCrawlBudget({
			signal: budget.deadline.signal,
			totalMs: budget.remainingMs() - reserve,
			now,
		});
		let directOutcome: DirectOutcome;
		try {
			const response = await directFetch(url, { headers, onRedirect: captureDirectHop, budget: directBudget });
			if (!isProxyWorthyResponse(response)) return response;
			directOutcome = { response };
		} catch (error) {
			if (!isProxyWorthyError(error)) throw error;
			directOutcome = { thrown: error };
		}
		const proxyTargetUrl = frozenProxyTarget({ entryUrl: url, directOutcome, lastDirectHopTarget });
		for (let attempt = 0; attempt < PROXY_ATTEMPTS; attempt++) {
			if (callerHasGivenUp(budget.deadline)) break;
			if (budget.remainingMs() < PROXY_ATTEMPT_FLOOR_MILLISECONDS) break;
			const proxyBudget = createCrawlBudget({
				signal: budget.deadline.signal,
				totalMs: budget.remainingMs(),
				now,
			});
			let response: Response;
			try {
				response = await proxyFetch(proxyTargetUrl, { headers, onRedirect, budget: proxyBudget });
			} catch (error) {
				if (!isTimeout(error)) break;
				continue;
			}
			if (!PROXY_GATEWAY_STATUSES.has(response.status)) return response;
			/* Drain the body of the answer being discarded, for the same reason the
			 * transport ladder drains an escalated one: an unread body holds its
			 * pooled socket, and the next attempt reuses that pool. */
			await response.text();
		}
		return surface(directOutcome);
	};
}

function frozenProxyTarget(params: {
	entryUrl: string;
	directOutcome: DirectOutcome;
	lastDirectHopTarget: string | undefined;
}): string {
	const { entryUrl, directOutcome, lastDirectHopTarget } = params;
	if ("response" in directOutcome) {
		const stamped = directOutcome.response.url;
		if (stamped !== "" && stamped !== entryUrl) return stamped;
	}
	return lastDirectHopTarget ?? entryUrl;
}

function surface(directOutcome: DirectOutcome): Response {
	if ("response" in directOutcome) return directOutcome.response;
	throw directOutcome.thrown;
}

function isProxyWorthyResponse(response: Response): boolean {
	return isBlockClassResponse(response) || response.status === 429;
}

function isTimeout(error: unknown): boolean {
	return error instanceof Error && error.name === "TimeoutError";
}

function isProxyWorthyError(error: unknown): boolean {
	if (isBlockClassError(error)) return true;
	return isTimeout(error);
}
