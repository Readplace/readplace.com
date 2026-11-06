import { z } from "zod";

export const MediaInspectionFactsSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("book"),
		title: z.string(),
		authors: z.array(z.string()),
		sectionTitles: z.array(z.string()),
	}),
]);
export type MediaInspectionFacts = z.infer<typeof MediaInspectionFactsSchema>;
