import { z } from "zod";

export const CrawlFailureReasonSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("parse-error"), detail: z.string() }),
	z.object({
		kind: z.literal("fetch-failed"),
		httpStatus: z.number().optional(),
	}),
	z.object({
		kind: z.literal("origin-unreachable"),
		httpStatus: z.number().optional(),
		code: z.string().optional(),
	}),
	z.object({
		kind: z.literal("exhausted-retries"),
		receiveCount: z.number(),
	}),
	z.object({
		kind: z.literal("blocked"),
		cause: z.enum(["edge-block", "robots", "rate-limited", "spend-capped"]),
	}),
	z.object({
		kind: z.literal("not-found"),
		httpStatus: z.union([z.literal(404), z.literal(410)]),
	}),
]);
export type CrawlFailureReason = z.infer<typeof CrawlFailureReasonSchema>;
