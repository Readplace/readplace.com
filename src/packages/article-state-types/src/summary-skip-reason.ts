import { z } from "zod";

export const SummarySkipReasonSchema = z.enum([
	"content-too-short",
	"ai-unavailable",
	"crawl-unsupported",
	"crawl-failed",
	"canonical-alias",
]);
export type SummarySkipReason = z.infer<typeof SummarySkipReasonSchema>;
