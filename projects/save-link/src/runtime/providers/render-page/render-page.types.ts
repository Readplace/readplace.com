export type RenderProxy = { server: string; username: string; password: string };

export type RenderOutcome =
	| { kind: "rendered"; html: string; finalUrl: string; httpStatus: number }
	| { kind: "blocked"; httpStatus: number }
	| { kind: "failed"; detail: string; httpStatus?: number };

export type RenderPage = (params: {
	url: string;
	proxy?: RenderProxy;
	navigationTimeoutMilliseconds: number;
}) => Promise<RenderOutcome>;
