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
 * status / content was ever recorded (see reader-slot.component.ts) — it
 * has no equivalent in the persisted crawl state machine. Composition via
 * z.union ensures a new CrawlStatus value propagates to ReaderStatus, so
 * any consumer with an exhaustive switch breaks at compile time.
 */
export const ReaderStatusSchema = z.union([CrawlStatusSchema, z.literal("unavailable")]);
export type ReaderStatus = z.infer<typeof ReaderStatusSchema>;

/**
 * Terminal-or-loading state of the clean reader view (crawled content + AI
 * summary), derived from the two underlying state machines. The single
 * source of truth for "is the reader view done?" — the domain effect
 * emission, the web reader/queue rendering, and the reader-ready notifier all
 * derive it here so future content-completeness rules extend in one place.
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
