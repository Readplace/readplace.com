export type RenderProxy = { server: string; username: string; password: string };

export type ResidentialEgress = { kind: "residential"; proxy: RenderProxy };
export type WebUnlockerEgress = { kind: "web-unlocker"; proxy: RenderProxy };
export type BrowserEgress = { kind: "direct" } | ResidentialEgress | WebUnlockerEgress;

export type RenderRequestTally = {
	continued: number;
	abortedByBudget: number;
	abortedByType: number;
	continuedByResourceType: Record<string, number>;
};

export type ClassifiedDocument =
	| { kind: "rendered"; html: string; finalUrl: string; httpStatus: number }
	| { kind: "blocked"; httpStatus: number }
	| { kind: "failed"; detail: string; httpStatus?: number };

export type RenderOutcome = ClassifiedDocument & { requests: RenderRequestTally };

export type RenderPage = (params: {
	url: string;
	egress: BrowserEgress;
	navigationTimeoutMilliseconds: number;
}) => Promise<RenderOutcome>;
