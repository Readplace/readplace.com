import type { RenderRequestRejection, RenderRequestTally } from "../../domain/render-crawl/render-page.types";

export function createRenderRequestCounts(params: { proxiedRequestLimit: number }) {
	const continuedByResourceType = new Map<string, number>();
	const abortedBy: Record<RenderRequestRejection, number> = { type: 0, address: 0, budget: 0 };
	let continuedProxied = 0;
	let continuedDirect = 0;
	let continuedNavigations = 0;
	return {
		continued: () => continuedProxied + continuedDirect,
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
			proxiedRequestLimit: params.proxiedRequestLimit,
			continued: continuedProxied + continuedDirect,
			continuedProxied,
			continuedDirect,
			continuedNavigations,
			abortedByBudget: abortedBy.budget,
			abortedByType: abortedBy.type + abortedBy.address,
			abortedBy: { ...abortedBy },
			continuedByResourceType: Object.fromEntries(continuedByResourceType),
		}),
	};
}
