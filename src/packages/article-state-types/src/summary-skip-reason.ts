import { z } from "zod";

export const SummarySkipReasonSchema = z.enum([
	"content-too-short",
	"ai-unavailable",
	"crawl-unsupported",
	"crawl-failed",
	"declined",
	"awaiting-reader",
]);
export type SummarySkipReason = z.infer<typeof SummarySkipReasonSchema>;
