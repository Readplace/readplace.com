import { z } from "zod";

export const SummarySkipReasonSchema = z.enum([
	"content-too-short",
	"ai-unavailable",
	"ai-no-text-block",
	"crawl-unsupported",
]);
export type SummarySkipReason = z.infer<typeof SummarySkipReasonSchema>;
