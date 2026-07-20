/**
 * The subscription filter every source log group carries, and the vocabulary the
 * forwarder classifies against.
 *
 * The stream names are written as literals rather than imported from
 * `@packages/web-analytics`, which is where `STREAMS` lives: that package already
 * depends on this one, so importing it back would close a dependency cycle. The
 * drift is guarded instead by a test in hutch that asserts these terms equal
 * `FORWARDED_STREAMS` and `STREAMS.parseErrors`.
 */

/** Business-history streams. Their lines route to the analytics funnel. */
export const ANALYTICS_FILTER_STREAMS = ["analytics", "conversions", "subscriptions"] as const;

/**
 * Operational streams that route to the errors funnel. Not business history, but
 * the dashboard's error widget reads only the funnel now, so a stream the filter
 * does not forward is a stream the operator can no longer see.
 */
export const ERROR_STREAMS = ["parse-errors"] as const;

/**
 * Plain-text failure output the Lambda runtime writes itself. None of it is JSON
 * and none contains the substring "ERROR" (CloudWatch terms are case-sensitive),
 * so every other term misses it — while it is the failure class an operator most
 * needs. This is why the filter is a text pattern rather than the JSON pattern it
 * used to be: CloudWatch cannot OR a JSON selector against a raw-text term.
 */
export const RUNTIME_FAILURE_MARKERS = [
	"Task timed out",
	"Runtime exited with error",
	"Runtime.OutOfMemory",
] as const;

/** A HutchLogger line logged at error level. Written as the serialized pair
 * because HutchLogger emits `JSON.stringify(data)` with no spaces, so this
 * appears verbatim — verified against real production log lines. */
const ERROR_LEVEL_TERM = '\\"level\\":\\"ERROR\\"';

/** Raw `logger.error` text the runtime tags ERROR with no JSON envelope. */
const RAW_ERROR_TERM = "ERROR";

function streamTerm(stream: string): string {
	return `\\"stream\\":\\"${stream}\\"`;
}

/**
 * Deliberately over-matches — a saved article whose title contains "ERROR"
 * forwards too. That costs forwarder invocations, not correctness, because the
 * handler re-decides precisely before writing and drops what neither funnel
 * claims. Over-matching is what keeps this to ONE filter per log group:
 * CloudWatch allows two, and spending both would leave the next change nowhere
 * to go.
 *
 * Verified against real production log lines with `aws logs test-metric-filter`
 * before shipping — which is how the missing parse-errors term was caught.
 */
export function buildObservabilityFilterPattern(): string {
	return [
		...ANALYTICS_FILTER_STREAMS.map(streamTerm),
		...ERROR_STREAMS.map(streamTerm),
		ERROR_LEVEL_TERM,
		RAW_ERROR_TERM,
		...RUNTIME_FAILURE_MARKERS,
	]
		.map((term) => `?"${term}"`)
		.join(" ");
}
