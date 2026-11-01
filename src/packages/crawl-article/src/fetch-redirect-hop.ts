import assert from "node:assert";
import { defaultResolveAll, type IsBlockedAddress, type ResolveAll } from "./blocked-address-lookup";
import type { CurlFetch } from "./curl-fetch";
import { createGuardedDispatcher } from "./guarded-dispatcher";
import { ESCALATE_STATUS_CODES } from "./transport-ladder";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export type FetchRedirectHop = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export function initFetchRedirectHop(deps: {
	fetch: typeof globalThis.fetch;
	isBlocked: IsBlockedAddress;
	resolve?: ResolveAll;
}): FetchRedirectHop {
	const { dispatcher } = createGuardedDispatcher({
		resolve: deps.resolve ?? defaultResolveAll,
		isBlocked: deps.isBlocked,
	});
	return async (url, init) => {
		const target = new URL(url);
		assert(
			ALLOWED_PROTOCOLS.has(target.protocol),
			`refusing to fetch non-HTTP(S) scheme "${target.protocol}"`,
		);
		const response = await deps.fetch(url, {
			headers: init.headers,
			signal: init.signal,
			dispatcher,
			redirect: "manual",
		});
		await response.body?.cancel();
		return response;
	};
}

export function escalateBlockedHop(deps: { direct: FetchRedirectHop; curl: CurlFetch }): FetchRedirectHop {
	return async (url, init) => {
		const response = await deps.direct(url, init);
		return ESCALATE_STATUS_CODES.has(response.status) ? deps.curl(url, init) : response;
	};
}
