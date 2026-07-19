import { FORWARDED_STREAMS, STREAMS } from "./events";

/**
 * Operational streams that belong in the errors funnel rather than the analytics
 * one. They are not in FORWARDED_STREAMS — that list is business history — but
 * the dashboard's error widget reads only the funnel now, so a stream the filter
 * does not forward is a stream the operator can no longer see.
 */
export const ERROR_STREAMS = [STREAMS.parseErrors] as const;

/**
 * Plain-text failure output the Lambda runtime writes itself. None of it is JSON
 * and none of it contains the substring "ERROR", so every other term in the
 * pattern misses it — while it is the failure class an operator most needs. This
 * is the whole reason the subscription filter is a text pattern rather than the
 * JSON pattern it used to be: CloudWatch cannot OR a JSON selector against a
 * raw-text term.
 */
export const RUNTIME_FAILURE_MARKERS = [
	"Task timed out",
	"Runtime exited with error",
	"Runtime.OutOfMemory",
] as const;

/** Matches a HutchLogger line logged at error level. Written as the serialized
 * pair because HutchLogger emits `JSON.stringify(data)` with no spaces, so this
 * appears verbatim in the log line. */
const ERROR_LEVEL_TERM = '\\"level\\":\\"ERROR\\"';

/** Catches raw `logger.error` text the Lambda runtime tags ERROR but that
 * carries no JSON envelope. Case-sensitive, like every CloudWatch text term. */
const RAW_ERROR_TERM = "ERROR";

function streamTerm(stream: string): string {
	return `\\"stream\\":\\"${stream}\\"`;
}

/**
 * The subscription filter every source log group carries.
 *
 * It deliberately over-matches — a saved article whose title contains "ERROR"
 * forwards too. That costs forwarder invocations, not correctness, because
 * `classifyForwardedLine` re-decides precisely before anything is written and
 * drops what neither funnel claims. Over-matching is what keeps this to ONE
 * filter per log group: CloudWatch allows two, and spending both would leave the
 * next change with nowhere to go.
 *
 * Verified against real production log lines with `aws logs test-metric-filter`
 * before shipping — which is how the missing parse-errors term was caught.
 */
export function buildObservabilityFilterPattern(): string {
	return [
		...FORWARDED_STREAMS.map(streamTerm),
		...ERROR_STREAMS.map(streamTerm),
		ERROR_LEVEL_TERM,
		RAW_ERROR_TERM,
		...RUNTIME_FAILURE_MARKERS,
	]
		.map((term) => `?"${term}"`)
		.join(" ");
}
