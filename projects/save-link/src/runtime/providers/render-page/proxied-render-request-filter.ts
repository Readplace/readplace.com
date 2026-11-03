import { createRenderRequestCounts } from "./render-request-counts";
import { createRenderResourceHosts } from "./render-resource-hosts";
import {
	ABORT_RENDER_REQUEST,
	type CreateRenderRequestFilter,
	hostOfRenderUrl,
	type RejectRenderRequest,
} from "./render-request-filter";
import { siteOfHost } from "./render-site";

const PROXIED_SUBRESOURCE_TYPES = new Set(["script", "xhr", "fetch"]);

export function initProxiedRenderRequestFilter(deps: {
	rejectRenderRequest: RejectRenderRequest;
	proxiedRequestLimit: number;
	maxResourceHostBuckets: number;
	directRenderRequestFilter: CreateRenderRequestFilter;
}): CreateRenderRequestFilter {
	return ({ proxied, url }) => {
		if (!proxied) return deps.directRenderRequestFilter({ proxied, url });
		const counts = createRenderRequestCounts({ policy: "same-site-scripts", proxiedRequestLimit: deps.proxiedRequestLimit });
		const hosts = createRenderResourceHosts({ initialHost: hostOfRenderUrl(url), maxBuckets: deps.maxResourceHostBuckets });
		return {
			decide: async (request) => {
				const { resourceType, isNavigation: navigation } = request;
				if (!navigation && !PROXIED_SUBRESOURCE_TYPES.has(resourceType)) {
					counts.reject("type");
					return ABORT_RENDER_REQUEST;
				}
				const parsedHost = URL.parse(request.url)?.hostname;
				if (!navigation && parsedHost !== undefined && siteOfHost(parsedHost) !== hosts.documentSite()) {
					counts.reject("site");
					hosts.record({ requestHost: parsedHost, resourceType, navigation, route: "aborted-site" });
					return ABORT_RENDER_REQUEST;
				}
				const rejection = await deps.rejectRenderRequest(request);
				if (rejection !== undefined) {
					counts.reject(rejection);
					return ABORT_RENDER_REQUEST;
				}
				const requestHost = hostOfRenderUrl(request.url);
				if (counts.continuedProxied() >= deps.proxiedRequestLimit) {
					counts.reject("budget");
					hosts.record({ requestHost, resourceType, navigation, route: "aborted-budget" });
					return ABORT_RENDER_REQUEST;
				}
				counts.admit({ resourceType, proxied: true, navigation });
				const settle = hosts.record({ requestHost, resourceType, navigation, route: "proxy" });
				if (navigation) hosts.enterDocument(requestHost);
				return { abort: false, settle };
			},
			tally: counts.tally,
			resourceHosts: hosts.snapshot,
		};
	};
}
