import type { HutchLogger } from "@packages/hutch-logger";
import {
	CRAWL_SETTLED_EVENT,
	CRAWL_SETTLED_METRIC,
	type CrawlSettledEvent,
	initLogCrawlSettled,
} from "@packages/hutch-infra-components";

function createCapturingLogger(): {
	logger: HutchLogger.Typed<CrawlSettledEvent>;
	captured: CrawlSettledEvent[];
} {
	const captured: CrawlSettledEvent[] = [];
	const logger: HutchLogger.Typed<CrawlSettledEvent> = {
		info: (data) => { captured.push(data); },
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { logger, captured };
}

describe("initLogCrawlSettled", () => {
	it("emits a crawl_settled event with the seconds from the crawl's start to now and the outcome", () => {
		const { logger, captured } = createCapturingLogger();
		const { logCrawlSettled } = initLogCrawlSettled({
			logger,
			now: () => new Date("2026-10-31T10:02:30.500Z"),
		});

		logCrawlSettled({ startedAt: "2026-10-31T10:00:00.000Z", outcome: "failed" });

		expect(captured).toEqual([{ event: "crawl_settled", latencySeconds: 150.5, outcome: "failed" }]);
	});

	it("carries no url, stream or timestamp field", () => {
		const { logger, captured } = createCapturingLogger();
		const { logCrawlSettled } = initLogCrawlSettled({
			logger,
			now: () => new Date("2026-10-31T10:00:01.000Z"),
		});

		logCrawlSettled({ startedAt: "2026-10-31T10:00:00.000Z", outcome: "ready" });

		expect(Object.keys(captured[0]).sort()).toEqual(["event", "latencySeconds", "outcome"]);
	});

	it("emits the event and the numeric field that CRAWL_SETTLED_METRIC's pattern and value read", () => {
		const { logger, captured } = createCapturingLogger();
		const { logCrawlSettled } = initLogCrawlSettled({
			logger,
			now: () => new Date("2026-10-31T10:00:42.000Z"),
		});

		logCrawlSettled({ startedAt: "2026-10-31T10:00:00.000Z", outcome: "unsupported" });

		expect(CRAWL_SETTLED_METRIC.filterPattern).toBe(`{ $.event = "${captured[0].event}" }`);
		expect(CRAWL_SETTLED_METRIC.filterPattern).toBe('{ $.event = "crawl_settled" }');
		expect(CRAWL_SETTLED_EVENT).toBe("crawl_settled");
		expect(CRAWL_SETTLED_METRIC.value).toBe("$.latencySeconds");
		expect(typeof captured[0].latencySeconds).toBe("number");
		expect(captured[0].latencySeconds).toBe(42);
		expect(captured[0].outcome).toBe("unsupported");
	});
});
