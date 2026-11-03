import type { IsBlockedAddress, ResolveAll } from "./blocked-address-lookup";
import type { TrackerPage } from "./fallback-link-target";
import { initGuardedManualFetch } from "./fetch-redirect-hop";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { BodyTooLargeError, readBodyWithCap } from "./read-capped-body";

export type TrackerHop = { response: Response; pageTarget: string | undefined };

export type FetchTrackerHop = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<TrackerHop>;

export function initFetchTrackerHop(deps: {
	fetch: typeof globalThis.fetch;
	isBlocked: IsBlockedAddress;
	resolve?: ResolveAll;
	pageTarget: (page: TrackerPage) => string | undefined;
}): FetchTrackerHop {
	const fetchOnce = initGuardedManualFetch(deps);
	async function readPage(response: Response): Promise<Buffer | undefined> {
		try {
			return await readBodyWithCap(response, MAX_HTML_BYTES.bytes);
		} catch (error) {
			if (error instanceof BodyTooLargeError) return undefined;
			throw error;
		}
	}
	return async (url, init) => {
		const response = await fetchOnce(url, init);
		if (response.status !== 200) {
			await response.body?.cancel();
			return { response, pageTarget: undefined };
		}
		const buffer = await readPage(response);
		if (buffer === undefined) return { response, pageTarget: undefined };
		return { response, pageTarget: deps.pageTarget({ response, buffer, documentUrl: url }) };
	};
}
