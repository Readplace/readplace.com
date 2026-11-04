import { z } from "zod";

export const DeferredMeteredLegSchema = z.enum([
	"render-residential-per-gb",
	"comprehensive",
	"content-judge",
]);
export type DeferredMeteredLeg = z.infer<typeof DeferredMeteredLegSchema>;

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
	z.object({
		kind: z.literal("awaiting-reader"),
		deferredLeg: DeferredMeteredLegSchema,
	}),
]);
export type CrawlUnsupportedReason = z.infer<typeof CrawlUnsupportedReasonSchema>;
