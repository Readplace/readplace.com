import { isIP } from "node:net";
import {
	createLiteralHostGuard,
	createPinnedAddressResolver,
	type IsBlockedAddress,
	type ResolveAll,
} from "@packages/crawl-article";

export type RenderRequest = { url: string; resourceType: string };

export type ShouldAbortRequest = (request: RenderRequest) => Promise<boolean>;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const SKIPPED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

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
