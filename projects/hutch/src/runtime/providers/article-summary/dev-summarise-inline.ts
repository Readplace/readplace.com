export type DevSummaryResult =
	| { kind: "ready"; summary: string; excerpt: string }
	| { kind: "skipped"; reason: string };

const MIN_CHARS_FOR_SUMMARY = 200;
const SUMMARY_PREFIX = "[dev summary] ";
const SUMMARY_BODY_CHARS = 280;
const EXCERPT_CHARS = 160;

export function devSummariseInline(input: { textContent: string }): DevSummaryResult {
	const text = input.textContent;
	if (text.length < MIN_CHARS_FOR_SUMMARY) {
		return { kind: "skipped", reason: "too-short" };
	}
	const summary = `${SUMMARY_PREFIX}${text.slice(0, SUMMARY_BODY_CHARS)}…`;
	const excerpt = text.slice(0, EXCERPT_CHARS);
	return { kind: "ready", summary, excerpt };
}
