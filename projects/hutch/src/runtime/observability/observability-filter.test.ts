import {
	ANALYTICS_FILTER_STREAMS,
	buildObservabilityFilterPattern,
	ERROR_STREAMS,
	RUNTIME_FAILURE_MARKERS,
} from "@packages/hutch-infra-components";
import { FORWARDED_STREAMS, STREAMS } from "./events";
import { classifyForwardedLine } from "../forward-analytics/forward-analytics-handler";

const pattern = buildObservabilityFilterPattern();

/** Approximates CloudWatch's OR-of-quoted-terms text pattern: each `?"term"` is
 * a case-sensitive substring test, and a line matches if any term is present. */
function matchesPattern(line: string): boolean {
	return [...pattern.matchAll(/\?"((?:[^"\\]|\\.)*)"/g)]
		.map((m) => m[1].replaceAll('\\"', '"'))
		.some((term) => line.includes(term));
}

describe("observability filter", () => {
	// The stream names are literals in @packages/hutch-infra-components because
	// @packages/web-analytics already depends on it, so importing STREAMS back
	// would close a dependency cycle. These two assertions are what stop the
	// duplicated literals drifting from the definitions they mirror.
	it("mirrors FORWARDED_STREAMS — the analytics vocabulary cannot drift from its definition", () => {
		expect([...ANALYTICS_FILTER_STREAMS]).toEqual([...FORWARDED_STREAMS]);
	});

	it("mirrors the operational error streams", () => {
		expect([...ERROR_STREAMS]).toEqual([STREAMS.parseErrors]);
	});

	it.each(FORWARDED_STREAMS)("forwards the %s stream, so business history reaches the funnel", (stream) => {
		expect(matchesPattern(`{"stream":"${stream}","event":"pageview"}`)).toBe(true);
	});

	// The bug this exists for: parse-errors was absent from the pattern, so the
	// classifier's parse-errors branch was dead in production — those lines were
	// never delivered to be classified. Caught with `aws logs test-metric-filter`
	// against real log lines, not by any unit test, which is why this one is here.
	it.each(ERROR_STREAMS)("forwards the %s stream — the classifier routes it, so the filter must deliver it", (stream) => {
		expect(matchesPattern(`{"stream":"${stream}","reason":"bad html"}`)).toBe(true);
	});

	it("forwards a structured logError line", () => {
		expect(matchesPattern('{"level":"ERROR","message":"boom"}')).toBe(true);
	});

	it.each(RUNTIME_FAILURE_MARKERS)("forwards the runtime's plain-text %s output", (marker) => {
		expect(matchesPattern(`2026-07-19T15:11:51.155Z req-1 ${marker} something`)).toBe(true);
	});

	it("leaves the runtime's per-invocation noise behind, which is the bulk of every log group", () => {
		for (const line of [
			"START RequestId: 59c35b35 Version: $LATEST",
			"END RequestId: 59c35b35",
			"REPORT RequestId: 59c35b35 Duration: 15.22 ms Billed Duration: 16 ms",
		]) {
			expect(matchesPattern(line)).toBe(false);
		}
	});

	// The filter and the classifier are two halves of one decision, in different
	// packages. A line the classifier claims but the filter drops is invisible.
	it("delivers every line the classifier claims", () => {
		const claimed = [
			...FORWARDED_STREAMS.map((s) => `{"stream":"${s}","event":"x"}`),
			...ERROR_STREAMS.map((s) => `{"stream":"${s}","reason":"x"}`),
			'{"level":"ERROR","message":"boom"}',
			...RUNTIME_FAILURE_MARKERS.map((m) => `req-1 ${m} detail`),
		];
		for (const line of claimed) {
			expect(classifyForwardedLine({ message: line, analyticsStreams: FORWARDED_STREAMS })).toBeDefined();
			expect(matchesPattern(line)).toBe(true);
		}
	});

	it("does not forward the operational streams that stay in their source group", () => {
		expect(matchesPattern(`{"stream":"${STREAMS.crawlOutcomes}","outcome":"ok"}`)).toBe(false);
	});
});
