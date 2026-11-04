export type RenderProxy = { server: string; username: string; password: string };

export type ResidentialEgress = { kind: "residential"; proxy: RenderProxy };
export type WebUnlockerEgress = { kind: "web-unlocker"; proxy: RenderProxy };
export type BrowserEgress = { kind: "direct" } | ResidentialEgress | WebUnlockerEgress;

export type RenderRequestRejection = "type" | "address" | "budget";

export type RenderRequestTally = {
	proxiedRequestLimit: number;
	continued: number;
	continuedProxied: number;
	continuedDirect: number;
	continuedNavigations: number;
	abortedByBudget: number;
	abortedByType: number;
	abortedBy: Record<RenderRequestRejection, number>;
	continuedByResourceType: Record<string, number>;
};

export type RenderResourceRoute = "proxy" | "direct" | "aborted-budget";

export type RenderResourceHostBucket = {
	documentSite: string;
	requestHost: string;
	resourceType: string;
	navigation: boolean;
	route: RenderResourceRoute;
	requests: number;
	response2xx: number;
	responseOther: number;
	failed: number;
};

export type RenderResourceHosts = {
	initialSite: string;
	finalSite: string;
	buckets: RenderResourceHostBucket[];
	overflowedRequests: number;
};

export type ClassifiedDocument =
	| { kind: "rendered"; html: string; finalUrl: string; httpStatus: number }
	| { kind: "blocked"; httpStatus: number }
	| { kind: "failed"; detail: string; httpStatus?: number };

export type RenderOutcome = ClassifiedDocument & { requests: RenderRequestTally; resourceHosts: RenderResourceHosts };

export type RenderPage = (params: {
	url: string;
	egress: BrowserEgress;
	navigationTimeoutMilliseconds: number;
}) => Promise<RenderOutcome>;
