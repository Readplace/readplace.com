import { UnauthorizedError } from "../auth/unauthorized-error";
import { assert } from "../invariant";
import type { RefreshTokens } from "../auth/auth.types";
import { SIREN_MEDIA_TYPE, RefreshUnavailableError } from "./siren-wire";
import type { DoFetch, DoFetchInit, ActionHandler } from "./siren-navigation.types";

export function createAuthorizedFetch(deps: {
	getAccessToken: () => Promise<string | null>;
	fetchFn: typeof fetch;
	onUnauthorized: (refusedAccessToken: string) => Promise<void>;
	refreshTokens: RefreshTokens;
}): DoFetch {
	async function attempt(url: string, init?: DoFetchInit): Promise<{ response: Response; accessToken: string }> {
		const accessToken = await deps.getAccessToken();
		assert(accessToken, "No access token available");
		const headers: Record<string, string> = {
			Authorization: `Bearer ${accessToken}`,
			Accept: SIREN_MEDIA_TYPE,
			...init?.headers,
		};
		return { response: await deps.fetchFn(url, { ...init, headers }), accessToken };
	}
	return async (url, init) => {
		const first = await attempt(url, init);
		if (first.response.status !== 401) return first.response;
		let refusedAccessToken = first.accessToken;
		const refreshed = await deps.refreshTokens({ refusedAccessToken });
		if (refreshed.ok) {
			const retried = await attempt(url, init);
			refusedAccessToken = retried.accessToken;
			if (retried.response.status !== 401) return retried.response;
		} else if (refreshed.reason === "unavailable") {
			throw new RefreshUnavailableError();
		}
		await deps.onUnauthorized(refusedAccessToken);
		throw new UnauthorizedError();
	};
}

export function createCachingFetch(
	cache: Map<string, { etag: string; body: unknown }>,
	original: DoFetch,
): DoFetch {
	return async (url, init) => {
		if (init?.method && init.method.toUpperCase() !== "GET")
			return original(url, init);

		const headers: Record<string, string> = { ...(init?.headers ?? {}) };
		const cached = cache.get(url);
		if (cached) headers["If-None-Match"] = cached.etag;

		const response = await original(url, { ...init, headers });

		if (response.status === 304 && cached) {
			return new Response(JSON.stringify(cached.body), {
				status: 200,
				headers: { "Content-Type": SIREN_MEDIA_TYPE },
			});
		}

		if (response.ok) {
			const etag = response.headers.get("etag");
			if (etag) {
				const clone = response.clone();
				cache.set(url, { etag, body: await clone.json() });
			}
		}

		return response;
	};
}

export function httpCacheable(
	understanding: Map<string, ActionHandler>,
): Map<string, ActionHandler> {
	const cache = new Map<string, { etag: string; body: unknown }>();

	const wrapped = new Map<string, ActionHandler>();
	for (const [name, handler] of understanding) {
		wrapped.set(name, (sirenAction, context) => {
			return handler(sirenAction, {
				...context,
				doFetch: createCachingFetch(cache, context.doFetch),
			});
		});
	}
	return wrapped;
}
