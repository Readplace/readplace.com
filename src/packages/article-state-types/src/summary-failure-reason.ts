import { z } from "zod";

export const SummaryFailureReasonSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("exhausted-retries"),
		receiveCount: z.number(),
	}),
	z.object({ kind: z.literal("crawl-failed") }),
	z.object({ kind: z.literal("model-overload") }),
	z.object({
		kind: z.literal("content-too-large"),
		tokens: z.number(),
	}),
]);
export type SummaryFailureReason = z.infer<typeof SummaryFailureReasonSchema>;
