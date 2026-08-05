import { z } from "zod";

export const SummaryStatusSchema = z.enum(["pending", "ready", "failed", "skipped"]);
export type SummaryStatus = z.infer<typeof SummaryStatusSchema>;

export const CrawlStatusSchema = z.enum(["pending", "ready", "failed", "unsupported"]);
export type CrawlStatus = z.infer<typeof CrawlStatusSchema>;

/**
 * Reader-slot UI status read from `data-reader-status` in rendered HTML.
 *
 * Composed of CrawlStatus + "unavailable". The "unavailable" state is a
 * UI-only signal for legacy rows where the article exists but no crawl
 * status / content was ever recorded — it
 * has no equivalent in the persisted crawl state machine. Composition via
 * z.union ensures a new CrawlStatus value propagates to ReaderStatus, so
 * any consumer with an exhaustive switch breaks at compile time.
 */
export const ReaderStatusSchema = z.union([CrawlStatusSchema, z.literal("unavailable")]);
export type ReaderStatus = z.infer<typeof ReaderStatusSchema>;

/**
 * Terminal-or-loading state of the clean reader view (crawled content + AI
 * summary), derived from the two underlying state machines. The single
 * source of truth for "is the reader view done?" — the domain effect emission
 * (mark-summary-ready / mark-summary-skipped) and the web reader/queue
 * rendering (isFullyParsed) derive it here so future content-completeness
 * rules extend in one place. The reader-ready notifier acts on the published
 * succeeded event downstream, so it consumes the fact rather than re-deriving.
 */
export const ReaderViewStatusSchema = z.enum(["loading", "succeeded", "failed"]);
export type ReaderViewStatus = z.infer<typeof ReaderViewStatusSchema>;

/* `failed` is checked before `succeeded` so a failed summary on a ready crawl
 * resolves to `failed`, never `succeeded`. A skipped summary is a success: the
 * reader view is complete, there is just nothing to summarise. */
export function deriveReaderViewStatus(input: {
	crawl: CrawlStatus;
	summary: SummaryStatus;
}): ReaderViewStatus {
	const { crawl, summary } = input;
	if (crawl === "failed" || crawl === "unsupported" || summary === "failed") {
		return "failed";
	}
	if (crawl === "ready" && (summary === "ready" || summary === "skipped")) {
		return "succeeded";
	}
	return "loading";
}

/* Reaching `succeeded` is a fact about a moment, not a standing condition: a
 * re-summarise of an already-succeeded article re-derives `succeeded` from
 * `succeeded` and must not re-announce it. */
export function enteredReaderViewSucceeded(input: {
	prior: ReaderViewStatus;
	next: ReaderViewStatus;
}): boolean {
	return input.next === "succeeded" && input.prior !== "succeeded";
}

/**
 * Operator-facing terminal outcome of a single state-machine axis, used by the
 * failed-articles canary to decide what counts as a debuggable failure.
 *
 * `complete` is a finished, non-error result: a `ready` crawl, a `skipped`
 * summary (nothing to summarise), or an `unsupported` crawl — a definitive
 * *supported* determination that the resource is a content type the product
 * does not render (e.g. an image). That is correct behaviour, not a bug. Only
 * `error` is a recoverable failure worth surfacing; `pending` is not terminal.
 *
 * Defined beside the status enums so the canary tracks production's notion of
 * complete-vs-error: adding or reclassifying a status is a compile break in
 * these exhaustive switches, not a silent change to what the canary reports.
 */
type AxisOutcome = "pending" | "complete" | "error";

export function classifyCrawlOutcome(status: CrawlStatus): AxisOutcome {
	switch (status) {
		case "pending":
			return "pending";
		case "ready":
		case "unsupported":
			return "complete";
		case "failed":
			return "error";
	}
}

export function classifySummaryOutcome(status: SummaryStatus): AxisOutcome {
	switch (status) {
		case "pending":
			return "pending";
		case "ready":
		case "skipped":
			return "complete";
		case "failed":
			return "error";
	}
}
