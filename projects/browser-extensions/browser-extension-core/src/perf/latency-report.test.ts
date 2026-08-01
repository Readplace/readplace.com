import {
	latencyReportPath,
	perfSetting,
	summarizeLatency,
} from "./latency-report";

describe("perfSetting", () => {
	const SETTING = "PERF_TEST_SETTING";

	afterEach(() => {
		delete process.env[SETTING];
	});

	it("reads a whole number a project declared for its suite", () => {
		process.env[SETTING] = "150";

		expect(perfSetting(SETTING)).toBe(150);
	});

	it("refuses a value that is not a number", () => {
		process.env[SETTING] = "soon";

		expect(() => perfSetting(SETTING)).toThrow(
			`${SETTING} must be a whole number, got "soon"`,
		);
	});

	it("refuses a negative budget", () => {
		process.env[SETTING] = "-1";

		expect(() => perfSetting(SETTING)).toThrow(
			`${SETTING} must be a whole number, got "-1"`,
		);
	});
});

describe("summarizeLatency", () => {
	it("summarizes an unsorted sample set", () => {
		expect(summarizeLatency([300, 100, 200, 900])).toEqual({
			count: 4,
			meanMs: 375,
			p50Ms: 200,
			p95Ms: 900,
			maxMs: 900,
		});
	});

	it("summarizes a single sample as every statistic", () => {
		expect(summarizeLatency([250])).toEqual({
			count: 1,
			meanMs: 250,
			p50Ms: 250,
			p95Ms: 250,
			maxMs: 250,
		});
	});

	it("refuses to summarize an empty sample set", () => {
		expect(() => summarizeLatency([])).toThrow(
			"a latency summary needs at least one sample",
		);
	});
});

describe("latencyReportPath", () => {
	it("writes into the project's own results directory when no artifact root is set", () => {
		expect(
			latencyReportPath({ root: undefined, runId: undefined, suite: "chrome" }),
		).toBe("test-results/perf/chrome-save-latency.json");
	});

	it("keys a report under the run it came from when an artifact root is set", () => {
		expect(
			latencyReportPath({ root: "/frames", runId: "4242", suite: "firefox" }),
		).toBe("/frames/4242/perf/firefox-save-latency.json");
	});

	it("files a report with no run id under a local run", () => {
		expect(
			latencyReportPath({ root: "/frames", runId: undefined, suite: "chrome" }),
		).toBe("/frames/local/perf/chrome-save-latency.json");
	});
});
