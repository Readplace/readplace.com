import { CRAWL_SETTLED_P99_SECONDS, estimateCrawlRemaining } from "./crawl-remaining-estimate";
import { crawlProgressPct } from "./progress-mapping";

const startedAt = "2026-11-05T10:00:00.000Z";
const secondsAfterStart = (seconds: number) => new Date(Date.parse(startedAt) + seconds * 1000);

describe("estimateCrawlRemaining", () => {
	it("stays quiet during the first five seconds so a quick save never shows a countdown", () => {
		expect(estimateCrawlRemaining({ startedAt, now: secondsAfterStart(2), pct: 8 })).toEqual({
			kind: "quiet",
			revealInSeconds: 3,
			seconds: 148,
		});
	});

	it("starts counting at the fifth second", () => {
		expect(estimateCrawlRemaining({ startedAt, now: secondsAfterStart(5), pct: 0 })).toEqual({
			kind: "counting",
			seconds: CRAWL_SETTLED_P99_SECONDS - 5,
		});
	});

	it("counts down one second per second while the stage holds", () => {
		expect(estimateCrawlRemaining({ startedAt, now: secondsAfterStart(40), pct: 8 })).toEqual({
			kind: "counting",
			seconds: 120,
		});
	});

	it("drops to the p99 less the share already done when the stage jumps", () => {
		expect(estimateCrawlRemaining({ startedAt, now: secondsAfterStart(10), pct: 20 })).toEqual({
			kind: "counting",
			seconds: 128,
		});
	});

	it("follows the comprehensive sub-stage interpolation", () => {
		const pct = crawlProgressPct({ stage: "comprehensive-extracting", parts: { current: 1, total: 2 } });
		expect(estimateCrawlRemaining({ startedAt, now: secondsAfterStart(10), pct })).toEqual({
			kind: "counting",
			seconds: 90,
		});
	});

	it("reads almost there once the count reaches zero", () => {
		expect(estimateCrawlRemaining({ startedAt, now: secondsAfterStart(200), pct: 8 })).toEqual({
			kind: "almost-there",
		});
	});
});
