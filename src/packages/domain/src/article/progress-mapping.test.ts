import {
	CRAWL_STAGES,
	CRAWL_STAGE_TO_PCT,
	SUMMARY_STAGES,
	SUMMARY_STAGE_TO_PCT,
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

	it("places summary stages strictly after the highest crawl stage so the bar never regresses when crawl flips ready", () => {
		const lastCrawl = Math.max(
			...CRAWL_STAGES.map((s) => CRAWL_STAGE_TO_PCT[s]),
		);
		const firstSummary = Math.min(
			...SUMMARY_STAGES.map((s) => SUMMARY_STAGE_TO_PCT[s]),
		);
		expect(firstSummary).toBeGreaterThan(lastCrawl);
	});

	it("starts the unified scale above 0 so the bar is visible immediately on crawl-fetching", () => {
		expect(crawlStagePct("crawl-fetching")).toBeGreaterThan(0);
	});

	it("keeps every summary stage below 100 so the projected bar can hover under the cap until the server flips status", () => {
		for (const stage of SUMMARY_STAGES) {
			expect(summaryStagePct(stage)).toBeLessThan(100);
		}
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
