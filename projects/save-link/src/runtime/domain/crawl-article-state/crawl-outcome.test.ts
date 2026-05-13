import type { HutchLogger } from "@packages/hutch-logger";
import {
	CRAWL_OUTCOME_STREAM,
	type CrawlOutcomeEvent,
	initLogCrawlOutcome,
} from "@packages/hutch-infra-components";

function createCapturingLogger(): {
	logger: HutchLogger.Typed<CrawlOutcomeEvent>;
	captured: CrawlOutcomeEvent[];
} {
	const captured: CrawlOutcomeEvent[] = [];
	const logger: HutchLogger.Typed<CrawlOutcomeEvent> = {
		info: (data) => { captured.push(data); },
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { logger, captured };
}

describe("initLogCrawlOutcome", () => {
	it("emits a tier-outcome event for tier-1 success with both-tier context", () => {
		const { logger, captured } = createCapturingLogger();
		const { logCrawlOutcome } = initLogCrawlOutcome({
			logger,
			now: () => new Date("2026-04-24T09:00:00.000Z"),
		});

		logCrawlOutcome({
			url: "https://example.com/a",
			thisTier: "tier-1",
			thisTierStatus: "success",
			otherTierStatus: "success",
			pickedTier: "tier-0",
		});

		expect(captured).toEqual([
			{
				stream: CRAWL_OUTCOME_STREAM,
				event: "tier-outcome",
				timestamp: "2026-04-24T09:00:00.000Z",
				url: "https://example.com/a",
				thisTier: "tier-1",
				thisTierStatus: "success",
				otherTierStatus: "success",
				pickedTier: "tier-0",
			},
		]);
	});

	it("emits a tier-outcome event for a tier-0 failure with the other tier not yet attempted", () => {
		const { logger, captured } = createCapturingLogger();
		const { logCrawlOutcome } = initLogCrawlOutcome({
			logger,
			now: () => new Date("2026-04-24T09:05:00.000Z"),
		});

		logCrawlOutcome({
			url: "https://example.com/b",
			thisTier: "tier-0",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});

		expect(captured[0]).toEqual({
			stream: CRAWL_OUTCOME_STREAM,
			event: "tier-outcome",
			timestamp: "2026-04-24T09:05:00.000Z",
			url: "https://example.com/b",
			thisTier: "tier-0",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});
	});
});
