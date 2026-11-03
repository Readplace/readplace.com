import type { RenderRequestPolicy, RenderRequestRejection, RenderRequestTally } from "./render-page.types";

export function createRenderRequestCounts(params: { policy: RenderRequestPolicy; proxiedRequestLimit: number }) {
	const continuedByResourceType = new Map<string, number>();
	const abortedBy: Record<RenderRequestRejection, number> = { type: 0, address: 0, site: 0, budget: 0 };
	let continuedProxied = 0;
	let continuedDirect = 0;
	let continuedNavigations = 0;
	return {
		continued: () => continuedProxied + continuedDirect,
		continuedProxied: () => continuedProxied,
		reject: (rejection: RenderRequestRejection) => {
			abortedBy[rejection] += 1;
		},
		admit: (request: { resourceType: string; proxied: boolean; navigation: boolean }) => {
			if (request.proxied) continuedProxied += 1;
			else continuedDirect += 1;
			if (request.navigation) continuedNavigations += 1;
			continuedByResourceType.set(request.resourceType, (continuedByResourceType.get(request.resourceType) ?? 0) + 1);
		},
		tally: (): RenderRequestTally => ({
			policy: params.policy,
			proxiedRequestLimit: params.proxiedRequestLimit,
			continued: continuedProxied + continuedDirect,
			continuedProxied,
			continuedDirect,
			continuedNavigations,
			abortedByBudget: abortedBy.budget,
			abortedByType: abortedBy.type + abortedBy.address + abortedBy.site,
			abortedBy: { ...abortedBy },
			continuedByResourceType: Object.fromEntries(continuedByResourceType),
		}),
	};
}
