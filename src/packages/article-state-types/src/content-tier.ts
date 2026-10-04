import { z } from "zod";

export const ContentTierSchema = z.enum(["tier-0", "tier-1", "tier-2"]);
export type ContentTier = z.infer<typeof ContentTierSchema>;

export const KNOWN_TIERS: readonly ContentTier[] = ContentTierSchema.options;

export const ARCHIVE_TIER: Extract<ContentTier, "tier-2"> = "tier-2";
