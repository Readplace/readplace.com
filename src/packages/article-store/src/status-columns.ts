import { CrawlStatusSchema, SummaryStatusSchema } from "@packages/article-state-types";
import { z } from "zod";

const CrawlColumns = z.discriminatedUnion("crawlStatus", [
	z.object({ crawlStatus: z.literal("failed"), crawlFailureReason: z.string().min(1) }),
	z.object({ crawlStatus: z.literal("unsupported"), crawlUnsupportedReason: z.string().min(1) }),
	z.object({ crawlStatus: CrawlStatusSchema.exclude(["failed", "unsupported"]).optional() }),
]);

const SummaryColumns = z.discriminatedUnion("summaryStatus", [
	z.object({ summaryStatus: z.literal("ready"), summary: z.string().min(1) }),
	z.object({ summaryStatus: z.literal("failed"), summaryFailureReason: z.string().min(1) }),
	z.object({ summaryStatus: SummaryStatusSchema.exclude(["ready", "failed"]).optional() }),
]);

export const SummaryStageColumn = z.enum(["summary-started", "summary-generating"]);

export function decodeCrawlColumns(row: {
	crawlStatus?: z.infer<typeof CrawlStatusSchema>;
	crawlFailureReason?: string;
	crawlUnsupportedReason?: string;
}): z.infer<typeof CrawlColumns> {
	return CrawlColumns.parse(row);
}

export function decodeSummaryColumns(row: {
	summaryStatus?: z.infer<typeof SummaryStatusSchema>;
	summary?: string;
	summaryFailureReason?: string;
}): z.infer<typeof SummaryColumns> {
	return SummaryColumns.parse(row);
}
