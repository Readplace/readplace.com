import { z } from "zod";
import type { Tier } from "./tier.types";

export const TierSourceMetadataSchema = z.object({
	title: z.string(),
	siteName: z.string(),
	excerpt: z.string(),
	wordCount: z.number(),
	estimatedReadTime: z.number(),
	imageUrl: z.string().optional(),
});

export type TierSourceMetadata = z.infer<typeof TierSourceMetadataSchema>;

export type TierSource = {
	tier: Tier;
	html: string;
	metadata: TierSourceMetadata;
};
