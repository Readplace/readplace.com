import {
	CRAWL_STAGES,
	CRAWL_STAGE_TO_PCT,
	SUMMARY_STAGES,
	SUMMARY_STAGE_TO_PCT,
	crawlProgressPct,
	crawlStagePct,
	summaryStagePct,
} from "./progress-mapping";

describe("progress-mapping", () => {
	it("orders crawl stages monotonically", () => {
		const pcts = CRAWL_STAGES.map((s) => CRAWL_STAGE_TO_PCT[s]);
		const sorted = [...pcts].sort((a, b) => a - b);
		expect(pcts).toEqual(sorted);
	});

	it("orders summary stages monotonically", () => {
		const pcts = SUMMARY_STAGES.map((s) => SUMMARY_STAGE_TO_PCT[s]);
		const sorted = [...pcts].sort((a, b) => a - b);
		expect(pcts).toEqual(sorted);
	});

	it("starts the reader axis above 0 so the bar is visible immediately on crawl-fetching", () => {
		expect(crawlStagePct("crawl-fetching")).toBeGreaterThan(0);
	});

	it("starts the summary axis above 0 so the bar is visible immediately on summary-started", () => {
		expect(summaryStagePct("summary-started")).toBeGreaterThan(0);
	});

	it("keeps every crawl stage below 100 so the label never reads 100% before the reader view lands", () => {
		for (const stage of CRAWL_STAGES) {
			expect(crawlStagePct(stage)).toBeLessThan(100);
		}
	});

	it("keeps every summary stage below 100 so the label never reads 100% before the summary lands", () => {
		for (const stage of SUMMARY_STAGES) {
			expect(summaryStagePct(stage)).toBeLessThan(100);
		}
	});

	it("ends each axis at exactly 90 on its last observable stage", () => {
		expect(Math.max(...CRAWL_STAGES.map((s) => CRAWL_STAGE_TO_PCT[s]))).toBe(90);
		expect(Math.max(...SUMMARY_STAGES.map((s) => SUMMARY_STAGE_TO_PCT[s]))).toBe(90);
		expect(crawlStagePct("crawl-content-uploaded")).toBe(90);
		expect(summaryStagePct("summary-generating")).toBe(90);
	});

	it("slots comprehensive-* stages between crawl-fetched and crawl-parsed so a PDF fallthrough never regresses the bar", () => {
		const fetched = crawlStagePct("crawl-fetched");
		const compFetching = crawlStagePct("comprehensive-fetching");
		const compExtracting = crawlStagePct("comprehensive-extracting");
		const compCleaning = crawlStagePct("comprehensive-cleaning");
		const parsed = crawlStagePct("crawl-parsed");
		expect(compFetching).toBeGreaterThan(fetched);
		expect(compExtracting).toBeGreaterThan(compFetching);
		expect(compCleaning).toBeGreaterThan(compExtracting);
		expect(parsed).toBeGreaterThan(compCleaning);
	});
});

describe("crawlProgressPct", () => {
	it("moves inside the comprehensive band as OCR parts land, so a 300-page PDF does not sit at the stage's base for minutes", () => {
		expect(
			crawlProgressPct({ stage: "comprehensive-extracting", parts: { current: 1, total: 2 } }),
		).toBe(44);
	});

	it("interpolates the cleaning sub-stage between its own base and crawl-parsed", () => {
		expect(
			crawlProgressPct({ stage: "comprehensive-cleaning", parts: { current: 1, total: 2 } }),
		).toBe(46.5);
	});

	it("returns the stage's base when a comprehensive sub-stage reports no parts", () => {
		expect(crawlProgressPct({ stage: "comprehensive-extracting" })).toBe(39);
	});

	it("ignores parts reported outside the comprehensive sub-stages", () => {
		expect(
			crawlProgressPct({ stage: "crawl-fetching", parts: { current: 1, total: 2 } }),
		).toBe(8);
	});

	it("reaches crawl-parsed when every part has landed", () => {
		expect(
			crawlProgressPct({ stage: "comprehensive-extracting", parts: { current: 4, total: 4 } }),
		).toBe(49);
	});

	it("returns the stage's base when the reported total is zero", () => {
		expect(
			crawlProgressPct({ stage: "comprehensive-extracting", parts: { current: 0, total: 0 } }),
		).toBe(39);
	});
});
