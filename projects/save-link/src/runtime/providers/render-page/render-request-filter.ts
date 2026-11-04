import assert from "node:assert";
import { isIP } from "node:net";
import {
	createLiteralHostGuard,
	createPinnedAddressResolver,
	type IsBlockedAddress,
	type ResolveAll,
} from "@packages/crawl-article";
import type { RenderRequestTally, RenderResourceHosts } from "./render-page.types";
import { createRenderRequestCounts } from "./render-request-counts";
import { createRenderResourceHosts, type SettleRenderRequest } from "./render-resource-hosts";

export type RenderRequest = { url: string; resourceType: string };

export type RejectRenderRequest = (request: RenderRequest) => Promise<"type" | "address" | undefined>;

export type RenderRequestVerdict = { abort: true } | { abort: false; settle: SettleRenderRequest };

export type RenderRequestFilter = {
	decide: (request: RenderRequest & { isNavigation: boolean }) => Promise<RenderRequestVerdict>;
	tally: () => RenderRequestTally;
	resourceHosts: () => RenderResourceHosts;
};

export type CreateRenderRequestFilter = (render: { proxied: boolean; url: string }) => RenderRequestFilter;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const SKIPPED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const PROXIED_REQUEST_LIMIT = 40;

const ABORT_RENDER_REQUEST: RenderRequestVerdict = { abort: true };

function hostOfRenderUrl(url: string): string {
	const parsed = URL.parse(url);
	assert(parsed !== null, "a render request reaching host classification carries a parseable URL");
	return parsed.hostname;
}

export function isMainFrameNavigation(request: { isNavigationRequest: () => boolean; frame: () => unknown }, mainFrame: unknown): boolean {
	return request.isNavigationRequest() && request.frame() === mainFrame;
}

export function initRejectRenderRequest(deps: { resolve: ResolveAll; isBlocked: IsBlockedAddress }): RejectRenderRequest {
	const assertHostAllowed = createLiteralHostGuard({ isBlocked: deps.isBlocked });
	const resolvePinnedAddress = createPinnedAddressResolver({ resolve: deps.resolve, isBlocked: deps.isBlocked });
	return async ({ url, resourceType }) => {
		if (SKIPPED_RESOURCE_TYPES.has(resourceType)) return "type";
		const parsed = URL.parse(url);
		if (parsed === null || !ALLOWED_PROTOCOLS.has(parsed.protocol)) return "address";
		const { hostname } = parsed;
		try {
			assertHostAllowed(hostname);
		} catch {
			return "address";
		}
		if (hostname.startsWith("[") || isIP(hostname) !== 0) return undefined;
		return resolvePinnedAddress({ hostname }).then(
			() => undefined,
			() => "address" as const,
		);
	};
}

export function initRenderRequestFilter(deps: { rejectRenderRequest: RejectRenderRequest; maxResourceHostBuckets: number }): CreateRenderRequestFilter {
	return ({ proxied, url }) => {
		const counts = createRenderRequestCounts({ proxiedRequestLimit: PROXIED_REQUEST_LIMIT });
		const hosts = createRenderResourceHosts({ initialHost: hostOfRenderUrl(url), maxBuckets: deps.maxResourceHostBuckets });
		return {
			decide: async (request) => {
				const rejection = await deps.rejectRenderRequest(request);
				if (rejection !== undefined) {
					counts.reject(rejection);
					return ABORT_RENDER_REQUEST;
				}
				const requestHost = hostOfRenderUrl(request.url);
				const { resourceType, isNavigation: navigation } = request;
				if (proxied && !navigation && counts.continued() >= PROXIED_REQUEST_LIMIT) {
					counts.reject("budget");
					hosts.record({ requestHost, resourceType, navigation, route: "aborted-budget" });
					return ABORT_RENDER_REQUEST;
				}
				counts.admit({ resourceType, proxied, navigation });
				const settle = hosts.record({ requestHost, resourceType, navigation, route: proxied ? "proxy" : "direct" });
				if (navigation) hosts.enterDocument(requestHost);
				return { abort: false, settle };
			},
			tally: counts.tally,
			resourceHosts: hosts.snapshot,
		};
	};
}
