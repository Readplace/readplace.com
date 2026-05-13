import { z } from "zod";

export const CrawlUnsupportedReasonSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("non-html-content"),
		contentType: z.string(),
	}),
	z.object({ kind: z.literal("paywall") }),
	z.object({ kind: z.literal("javascript-required") }),
	z.object({
		kind: z.literal("content-too-large"),
		bytes: z.number(),
	}),
]);
export type CrawlUnsupportedReason = z.infer<typeof CrawlUnsupportedReasonSchema>;
