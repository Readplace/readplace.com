import assert from "node:assert";
import { callerHasGivenUp, type CrawlBudget, type LegDeadline } from "./crawl-budget";
import type { OnRedirect } from "./follow-redirects";

/**
 * Edge vendors spell the same bot-deny verdict four ways: Cloudflare as a 403
 * managed challenge, Cloudflare again as a 429 with no retry-after (observed on
 * linkedin.com from Lambda egress, hours apart, so not a real rate limit),
 * CloudFront as a 401 on a host answering 200 for its own assets in the same
 * second, and Cloudflare pay-per-crawl as a 402 (observed on seriouseats.com
 * from Lambda egress, which answers 403 to the same URL from a residential
 * one, so the price is on the egress and not on the document). None of the
 * four is reliably what its status says.
 */
const ESCALATE_STATUS_CODES = new Set([401, 402, 403, 429]);

const TERMINAL_NETWORK_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]);

type LegName = "primary" | "h2" | "curl" | "proxy";

export type LegFetch = (
	url: string,
	init: { headers: Record<string, string>; deadline: LegDeadline; onRedirect?: OnRedirect },
) => Promise<Response>;

export type Leg = {
	readonly name: LegName;
	readonly maxRunMs: number;
	readonly fetch: LegFetch;
};

export type LegAttempt = {
	readonly leg: LegName;
	readonly outcome: "answered" | "escalated" | "abandoned";
	readonly elapsedMs: number;
	readonly status?: number;
	readonly error?: string;
};

export type LadderFetch = (
	url: string,
	init: { headers: Record<string, string>; budget: CrawlBudget; onRedirect?: OnRedirect },
) => Promise<Response>;

function isTerminalNetworkError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return "code" in error && typeof error.code === "string" && TERMINAL_NETWORK_CODES.has(error.code);
}

export function runTransportLadder(deps: {
	legs: readonly Leg[];
	logAttempt: (attempt: LegAttempt) => void;
	now: () => number;
}): LadderFetch {
	const { legs, logAttempt, now } = deps;
	assert(legs.length > 0, "runTransportLadder requires at least one leg");
	assert(
		legs.every((leg) => leg.maxRunMs > 0),
		"every ladder leg needs a positive maxRunMs to earn a share of the budget",
	);
	return async (url, init) => {
		const { headers, budget, onRedirect } = init;
		let lastError: unknown;
		let lastResponse: Response | undefined;
		for (const [index, leg] of legs.entries()) {
			if (callerHasGivenUp(budget.deadline)) break;
			const shareOfWeight = legs.slice(index).reduce((total, remaining) => total + remaining.maxRunMs, 0);
			const shareMs = Math.floor((budget.remainingMs() * leg.maxRunMs) / shareOfWeight);
			const lease = budget.leaseLeg(Math.min(leg.maxRunMs, shareMs));
			const startedAt = now();
			try {
				const response = await leg.fetch(url, { headers, deadline: lease.deadline, onRedirect });
				if (!ESCALATE_STATUS_CODES.has(response.status)) {
					logAttempt({ leg: leg.name, outcome: "answered", elapsedMs: now() - startedAt, status: response.status });
					return response;
				}
				await response.text();
				logAttempt({ leg: leg.name, outcome: "escalated", elapsedMs: now() - startedAt, status: response.status });
				lastResponse = response;
			} catch (error) {
				if (error instanceof Error && lastError !== undefined) error.cause = lastError;
				const elapsedMs = now() - startedAt;
				const message = error instanceof Error ? error.message : String(error);
				if (callerHasGivenUp(budget.deadline) || isTerminalNetworkError(error)) {
					logAttempt({ leg: leg.name, outcome: "abandoned", elapsedMs, error: message });
					throw error;
				}
				logAttempt({ leg: leg.name, outcome: "escalated", elapsedMs, error: message });
				lastError = error;
			} finally {
				lease.release();
			}
		}
		if (lastResponse !== undefined) return lastResponse;
		if (lastError !== undefined) throw lastError;
		throw budget.deadline.signal.reason;
	};
}
