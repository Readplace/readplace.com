import assert from "node:assert";
import { Agent, buildConnector, type Dispatcher, ProxyAgent } from "undici";
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
import { withProxiedLadderFallback } from "./proxied-ladder-fallback";
import { RATE_LIMIT_RETRY_DELAYS_MS, withRateLimitRetry } from "./rate-limit-retry";
import { type LadderFetch, type Leg, type LegAttempt, runTransportLadder } from "./transport-ladder";

const PRIMARY_LEG_MAX_MS = 25_000;
const H2_LEG_MAX_MS = 2000;
const CURL_LEG_MAX_MS = 3000;
/* An unlocker proxy solves the challenge before answering, so it is far slower
 * than a direct fetch: measured against the blocked-row set, successes ran a
 * 12.6s median and a 37.2s 90th percentile. A reserve that cannot seat those
 * turns recoverable rows into timeouts, so the proxied pass is budgeted for the
 * 90th percentile rather than the median. */
const PROXY_RESERVE_MILLISECONDS = 45_000;
const PROXY_PRIMARY_MAX_MILLISECONDS = 40_000;

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
	proxyUrl: string | undefined;
	fetchProxyCurl?: CurlFetch;
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
	function buildPrimaryFetch(primaryDispatcher: Dispatcher, opts: { chaseAia: boolean }): PrimaryFetch {
		const followRedirects = redirectable(
			(url, hopInit) =>
				deps.fetch(url, {
					headers: hopInit?.headers,
					signal: hopInit?.signal,
					dispatcher: primaryDispatcher,
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
		/* AIA chasing fetches the missing issuer cert directly, so it can't ride
		 * the proxy tunnel — skip it on the proxied primary and let the proxied
		 * curl leg cover a chain-broken origin instead. */
		return opts.chaseAia
			? withAiaChasing(guardedFetch, initDefaultFetchAia({ lookup, assertHostAllowed }))
			: guardedFetch;
	}
	const fetchH2 = deps.fetchH2 ?? initFetchH2({ lookup, assertHostAllowed });
	const fetchCurl = deps.fetchCurl ?? initGuardedCurlFetch({ resolve, isBlocked });
	const primaryLeg = (fetchPrimary: PrimaryFetch, maxRunMs: number): Leg => ({
		name: "primary",
		maxRunMs,
		fetch: (url, init) =>
			fetchPrimary(url, { headers: init.headers, signal: init.deadline.signal, onRedirect: init.onRedirect }),
	});
	const curlLeg = (curlFetch: CurlFetch): Leg => ({
		name: "curl",
		maxRunMs: CURL_LEG_MAX_MS,
		fetch: (url, init) => curlFetch(url, { headers: init.headers, signal: init.deadline.signal }),
	});
	const directLegs: readonly Leg[] = [
		primaryLeg(buildPrimaryFetch(dispatcher, { chaseAia: true }), PRIMARY_LEG_MAX_MS),
		{
			name: "h2",
			maxRunMs: H2_LEG_MAX_MS,
			fetch: (url, init) => fetchH2(url, { headers: init.headers, signal: init.deadline.signal }),
		},
		curlLeg(fetchCurl),
	];
	const logAttempt = (attempt: LegAttempt) => logInfo(JSON.stringify({ stream: "crawl-legs", ...attempt }));
	const directPipeline = withRateLimitRetry(
		withPersonaFallback(runTransportLadder({ legs: directLegs, logAttempt, now: Date.now }), deps.personas),
		{ delaysMs: deps.rateLimitRetryDelaysMs ?? RATE_LIMIT_RETRY_DELAYS_MS },
	);
	/* Node's http2 has no proxy path and curl-impersonate through the proxy
	 * already presents a browser h2 fingerprint, so the proxied pass omits the
	 * h2 leg. */
	function buildProxyPipeline(): LadderFetch | undefined {
		const proxyUrl = deps.proxyUrl;
		if (proxyUrl === undefined) return undefined;
		const fetchProxyCurl = deps.fetchProxyCurl ?? initGuardedCurlFetch({ resolve, isBlocked, proxyUrl });
		/* Same TLS-termination reason as the proxied curl leg: the unlocker
		 * presents its own certificate, so verification is relaxed here and only
		 * here — the direct dispatcher above keeps the SSRF-guarded connector and
		 * full verification. */
		const proxyDispatcher = new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } });
		const proxyLegs: readonly Leg[] = [
			primaryLeg(buildPrimaryFetch(proxyDispatcher, { chaseAia: false }), PROXY_PRIMARY_MAX_MILLISECONDS),
			curlLeg(fetchProxyCurl),
		];
		const proxyLogAttempt = (attempt: LegAttempt) =>
			logInfo(JSON.stringify({ stream: "crawl-legs", via: "proxy", ...attempt }));
		return withPersonaFallback(
			runTransportLadder({ legs: proxyLegs, logAttempt: proxyLogAttempt, now: Date.now }),
			deps.personas,
		);
	}
	const proxyPipeline = buildProxyPipeline();
	const fetchWithFallback =
		proxyPipeline === undefined
			? directPipeline
			: withProxiedLadderFallback({
					directFetch: directPipeline,
					proxyFetch: proxyPipeline,
					proxyReserveMilliseconds: PROXY_RESERVE_MILLISECONDS,
					now: Date.now,
				});
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
