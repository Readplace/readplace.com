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
