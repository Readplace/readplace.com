import { isIP } from "node:net";
import {
	createLiteralHostGuard,
	createPinnedAddressResolver,
	type IsBlockedAddress,
	type ResolveAll,
} from "@packages/crawl-article";
import type { RenderRequestTally } from "./render-page.types";

export type RenderRequest = { url: string; resourceType: string };

export type ShouldAbortRequest = (request: RenderRequest) => Promise<boolean>;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const SKIPPED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const MAX_PROXIED_REQUESTS_PER_RENDER = 40;

export type CreateRenderRequestFilter = (render: { proxied: boolean }) => {
	shouldAbortRequest: (request: RenderRequest & { isNavigation: boolean }) => Promise<boolean>;
	tally: () => RenderRequestTally;
};

export function isMainFrameNavigation(request: { isNavigationRequest: () => boolean; frame: () => unknown }, mainFrame: unknown): boolean {
	return request.isNavigationRequest() && request.frame() === mainFrame;
}

export function initShouldAbortRequest(deps: { resolve: ResolveAll; isBlocked: IsBlockedAddress }): ShouldAbortRequest {
	const assertHostAllowed = createLiteralHostGuard({ isBlocked: deps.isBlocked });
	const resolvePinnedAddress = createPinnedAddressResolver({ resolve: deps.resolve, isBlocked: deps.isBlocked });
	return async ({ url, resourceType }) => {
		if (SKIPPED_RESOURCE_TYPES.has(resourceType)) return true;
		const parsed = URL.parse(url);
		if (parsed === null || !ALLOWED_PROTOCOLS.has(parsed.protocol)) return true;
		const { hostname } = parsed;
		try {
			assertHostAllowed(hostname);
		} catch {
			return true;
		}
		if (hostname.startsWith("[") || isIP(hostname) !== 0) return false;
		return resolvePinnedAddress({ hostname }).then(
			() => false,
			() => true,
		);
	};
}

export function initRenderRequestFilter(deps: { shouldAbortRequest: ShouldAbortRequest }): CreateRenderRequestFilter {
	return ({ proxied }) => {
		const continuedByResourceType = new Map<string, number>();
		let continued = 0;
		let abortedByBudget = 0;
		let abortedByType = 0;
		return {
			shouldAbortRequest: async (request) => {
				if (await deps.shouldAbortRequest(request)) {
					abortedByType += 1;
					return true;
				}
				if (proxied && !request.isNavigation && continued >= MAX_PROXIED_REQUESTS_PER_RENDER) {
					abortedByBudget += 1;
					return true;
				}
				continued += 1;
				continuedByResourceType.set(request.resourceType, (continuedByResourceType.get(request.resourceType) ?? 0) + 1);
				return false;
			},
			tally: () => ({
				continued,
				abortedByBudget,
				abortedByType,
				continuedByResourceType: Object.fromEntries(continuedByResourceType),
			}),
		};
	};
}
