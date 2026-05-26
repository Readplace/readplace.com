/**
 * Format an HTTP status code from a thrown error for inclusion in a log
 * line. The OpenAI SDK attaches a numeric `.status` to its `APIError`
 * subclasses (e.g. `RateLimitError` has `status === 429`), so when an LLM
 * call throws, this helper surfaces that status as ` status=429` in the
 * handler's warn line. Operators can then `grep status=429` in CloudWatch
 * to spot sustained rate-limiting from DeepSeek without parsing free-form
 * error messages. Returns an empty string when the thrown value has no
 * numeric status — keeps the log line clean for plain `Error` throws and
 * non-Error values.
 */
export function httpStatusTag(error: unknown): string {
	if (typeof error !== "object" || error === null || !("status" in error)) return "";
	const status = (error as { status: unknown }).status;
	if (typeof status !== "number") return "";
	return ` status=${status}`;
}
