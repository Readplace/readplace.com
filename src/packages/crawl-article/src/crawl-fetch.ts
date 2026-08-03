import assert from "node:assert";
import { Agent, buildConnector } from "undici";
import { initDefaultFetchAia, type PrimaryFetch, withAiaChasing } from "./aia-fetch";
import {
	createBlockedAddressLookup,
	createLiteralHostGuard,
	defaultResolveAll,
	type IsBlockedAddress,
	type ResolveAll,
} from "./blocked-address-lookup";
import { createCrawlBudget, deadlineReason } from "./crawl-budget";
import { type CurlFetch, initGuardedCurlFetch } from "./curl-fetch";
import { type OnRedirect, redirectable } from "./follow-redirects";
import { type FetchH2, initFetchH2 } from "./h2-fetch";
import { type Persona, withPersonaFallback } from "./persona-fallback";
import { RATE_LIMIT_RETRY_DELAYS_MS, withRateLimitRetry } from "./rate-limit-retry";
import { type Leg, type LegAttempt, type LegFetch, runTransportLadder } from "./transport-ladder";

const PRIMARY_LEG_MAX_MS = 25_000;
const H2_LEG_MAX_MS = 2000;
const CURL_LEG_MAX_MS = 3000;

export type CrawlFetchInit = {
	headers?: Record<string, string>;
	budgetMs: number;
	signal?: AbortSignal;
	referer?: string;
	onRedirect?: OnRedirect;
};

export type CrawlFetch = (url: string, init: CrawlFetchInit) => Promise<Response>;

export function initCrawlFetch(deps: {
	fetch: typeof globalThis.fetch;
	personas: ReadonlyArray<Persona>;
	isBlocked: IsBlockedAddress;
	logInfo: (message: string) => void;
	resolve?: ResolveAll;
	fetchH2?: FetchH2;
	fetchCurl?: CurlFetch;
	rateLimitRetryDelaysMs?: readonly number[];
}): CrawlFetch {
	const resolve = deps.resolve ?? defaultResolveAll;
	const { isBlocked, logInfo } = deps;
	const lookup = createBlockedAddressLookup({ resolve, isBlocked });
	const assertHostAllowed = createLiteralHostGuard({ isBlocked });
	const baseConnector = buildConnector({ lookup });
	const dispatcher = new Agent({
		connect(options, callback) {
			try {
				assertHostAllowed(options.hostname);
			} catch (error) {
				assert(error instanceof Error, "createLiteralHostGuard only throws Error");
				callback(error, null);
				return;
			}
			baseConnector(options, callback);
		},
	});
	const followRedirects = redirectable(
		(url, hopInit) =>
			deps.fetch(url, {
				headers: hopInit?.headers,
				signal: hopInit?.signal,
				dispatcher,
				redirect: "manual",
			}),
		"fetchPrimary",
	);
	const guardedFetch: PrimaryFetch = (url, init) =>
		followRedirects(url, {
			headers: init.headers,
			signal: init.signal,
			onRedirect: init.onRedirect,
		});
	const primaryFetch = withAiaChasing(guardedFetch, initDefaultFetchAia({ lookup, assertHostAllowed }));
	const fetchH2 = deps.fetchH2 ?? initFetchH2({ lookup, assertHostAllowed });
	const fetchCurl = deps.fetchCurl ?? initGuardedCurlFetch({ resolve, isBlocked });
	const primaryLeg: LegFetch = (url, init) =>
		primaryFetch(url, { headers: init.headers, signal: init.deadline.signal, onRedirect: init.onRedirect });
	const legs: readonly Leg[] = [
		{ name: "primary", maxRunMs: PRIMARY_LEG_MAX_MS, fetch: primaryLeg },
		{
			name: "h2",
			maxRunMs: H2_LEG_MAX_MS,
			fetch: (url, init) => fetchH2(url, { headers: init.headers, signal: init.deadline.signal }),
		},
		{
			name: "curl",
			maxRunMs: CURL_LEG_MAX_MS,
			fetch: (url, init) => fetchCurl(url, { headers: init.headers, signal: init.deadline.signal }),
		},
	];
	const logAttempt = (attempt: LegAttempt) => logInfo(JSON.stringify({ stream: "crawl-legs", ...attempt }));
	const fetchWithFallback = withRateLimitRetry(
		withPersonaFallback(runTransportLadder({ legs, logAttempt, now: Date.now }), deps.personas),
		{ delaysMs: deps.rateLimitRetryDelaysMs ?? RATE_LIMIT_RETRY_DELAYS_MS },
	);
	return async (url, init) => {
		assert(
			!(init.referer && init.headers?.referer),
			"Pass referer via the `referer` field or `headers.referer`, not both",
		);
		const headers: Record<string, string> = { ...init.headers };
		if (init.referer) headers.referer = init.referer;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort(deadlineReason(`no response headers within ${init.budgetMs}ms`));
		}, init.budgetMs);
		const external = init.signal;
		if (external) {
			const forwardExternalAbort = () => {
				clearTimeout(timer);
				controller.abort(external.reason);
			};
			if (external.aborted) forwardExternalAbort();
			else external.addEventListener("abort", forwardExternalAbort, { once: true });
		}
		const budget = createCrawlBudget({ signal: controller.signal, totalMs: init.budgetMs, now: Date.now });
		return fetchWithFallback(url, { headers, budget, onRedirect: init.onRedirect })
			.catch((error) => {
				if (controller.signal.aborted) throw controller.signal.reason;
				throw error;
			})
			.finally(() => clearTimeout(timer));
	};
}
