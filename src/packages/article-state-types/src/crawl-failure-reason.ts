import { z } from "zod";

export const CrawlFailureReasonSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("parse-error"), detail: z.string() }),
	z.object({
		kind: z.literal("fetch-failed"),
		httpStatus: z.number().optional(),
	}),
	z.object({
		kind: z.literal("exhausted-retries"),
		receiveCount: z.number(),
	}),
	z.object({
		kind: z.literal("blocked"),
		cause: z.enum(["cloudflare", "robots", "rate-limited"]),
	}),
]);
export type CrawlFailureReason = z.infer<typeof CrawlFailureReasonSchema>;
