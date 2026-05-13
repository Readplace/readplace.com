import { z } from "zod";

export const TierSchema = z.enum(["tier-0", "tier-1"]);
export type Tier = z.infer<typeof TierSchema>;

export const KNOWN_TIERS: readonly Tier[] = TierSchema.options;
