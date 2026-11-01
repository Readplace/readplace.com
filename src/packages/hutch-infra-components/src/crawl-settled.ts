export const CRAWL_SETTLED_EVENT = "crawl_settled";

export const CRAWL_SETTLED_METRIC = {
	namespace: "Readplace/SaveLink",
	name: "CrawlSettledLatency",
	filterPattern: `{ $.event = ${JSON.stringify(CRAWL_SETTLED_EVENT)} }`,
	value: "$.latencySeconds",
};

export interface CrawlSettledEvent {
	event: typeof CRAWL_SETTLED_EVENT;
	latencySeconds: number;
	outcome: "ready" | "failed" | "unsupported";
}

export type LogCrawlSettled = (params: { startedAt: string; outcome: CrawlSettledEvent["outcome"] }) => void;

export function initLogCrawlSettled(deps: {
	logger: { info: (event: CrawlSettledEvent) => void };
	now: () => Date;
}): { logCrawlSettled: LogCrawlSettled } {
	const logCrawlSettled: LogCrawlSettled = (params) => {
		deps.logger.info({
			event: CRAWL_SETTLED_EVENT,
			latencySeconds: (deps.now().getTime() - new Date(params.startedAt).getTime()) / 1000,
			outcome: params.outcome,
		});
	};
	return { logCrawlSettled };
}
