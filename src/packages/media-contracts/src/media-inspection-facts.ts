import { z } from "zod";

export const MediaInspectionFactsSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("book"),
		title: z.string(),
		authors: z.array(z.string()),
		sectionTitles: z.array(z.string()),
	}),
	z.object({
		kind: z.enum(["audio", "video"]),
		shape: z.literal("timed"),
		durationSeconds: z.number().nonnegative(),
	}),
]);
export type MediaInspectionFacts = z.infer<typeof MediaInspectionFactsSchema>;
