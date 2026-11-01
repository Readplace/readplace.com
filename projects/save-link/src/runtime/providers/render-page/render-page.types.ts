export type RenderProxy = { server: string; username: string; password: string };

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
	proxy?: RenderProxy;
	navigationTimeoutMilliseconds: number;
}) => Promise<RenderOutcome>;
