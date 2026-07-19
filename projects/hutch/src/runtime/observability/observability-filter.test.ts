import { FORWARDED_STREAMS, STREAMS } from "./events";
import {
	buildObservabilityFilterPattern,
	ERROR_STREAMS,
	RUNTIME_FAILURE_MARKERS,
} from "./observability-filter";
import { classifyForwardedLine } from "../forward-analytics/forward-analytics-handler";

const pattern = buildObservabilityFilterPattern();

/** Approximates CloudWatch's OR-of-quoted-terms text pattern: each `?"term"` is
 * a case-sensitive substring test, and a line matches if any term is present. */
function matchesPattern(line: string): boolean {
	return [...pattern.matchAll(/\?"((?:[^"\\]|\\.)*)"/g)]
		.map((m) => m[1].replaceAll('\\"', '"'))
		.some((term) => line.includes(term));
}

describe("buildObservabilityFilterPattern", () => {
	it.each(FORWARDED_STREAMS)("forwards the %s stream, so business history reaches the funnel", (stream) => {
		expect(matchesPattern(`{"stream":"${stream}","event":"pageview"}`)).toBe(true);
	});

	// The bug this test exists for: parse-errors was absent from the pattern, so
	// the classifier's parse-errors branch was dead in production — those lines
	// were never delivered to classify. Caught with `aws logs test-metric-filter`
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

	// The filter and the classifier are two halves of one decision and live in
	// different modules. A stream the classifier claims but the filter drops is
	// invisible; this is the guard that they agree.
	it("delivers every line the classifier claims — a stream the filter drops can never be classified", () => {
		const claimed = [
			...FORWARDED_STREAMS.map((s) => `{"stream":"${s}","event":"x"}`),
			...ERROR_STREAMS.map((s) => `{"stream":"${s}","reason":"x"}`),
			'{"level":"ERROR","message":"boom"}',
			...RUNTIME_FAILURE_MARKERS.map((m) => `req-1 ${m} detail`),
		];
		for (const line of claimed) {
			expect(
				classifyForwardedLine({ message: line, analyticsStreams: FORWARDED_STREAMS }),
			).toBeDefined();
			expect(matchesPattern(line)).toBe(true);
		}
	});

	it("does not forward the operational streams that stay in their source group", () => {
		expect(matchesPattern(`{"stream":"${STREAMS.crawlOutcomes}","outcome":"ok"}`)).toBe(false);
	});
});
