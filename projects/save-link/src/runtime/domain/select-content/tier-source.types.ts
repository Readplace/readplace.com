import { z } from "zod";
import type { Tier } from "./tier.types";

export const TierSourceMetadataSchema = z.object({
	title: z.string(),
	siteName: z.string(),
	excerpt: z.string(),
	wordCount: z.number(),
	estimatedReadTime: z.number(),
	imageUrl: z.string().optional(),
	/** Who captured this source. Present only on tier-0 sidecars written after
	 * attribution shipped; tier-1 (anonymous crawler) sources never carry one.
	 * The tier-0 slot is a single object per URL, so among co-savers the
	 * recorded author is last-writer-wins. */
	authorUserId: z.string().optional(),
});

export type TierSourceMetadata = z.infer<typeof TierSourceMetadataSchema>;

export type TierSource = {
	tier: Tier;
	html: string;
	metadata: TierSourceMetadata;
};
