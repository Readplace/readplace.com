import { z } from "zod";

export const CrawlVersionEntrySchema = z.object({
	minuteId: z.string(),
	authorUserId: z.string().optional(),
});
export type CrawlVersionEntry = z.infer<typeof CrawlVersionEntrySchema>;

/** 1. Rows written before attribution hold bare minute-id strings; both forms
 *     stay readable forever because the log is never rewritten in place. */
export const StoredCrawlVersionSchema = z.union([
	z.string() /* 1 */,
	CrawlVersionEntrySchema,
]);
export type StoredCrawlVersion = z.infer<typeof StoredCrawlVersionSchema>;

export function normalizeCrawlVersion(stored: StoredCrawlVersion): CrawlVersionEntry {
	return typeof stored === "string" ? { minuteId: stored } : stored;
}
