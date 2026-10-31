import { z } from "zod";

export const DeepseekUsageSchema = z.object({
	prompt_tokens: z.number(),
	completion_tokens: z.number(),
	prompt_cache_hit_tokens: z.number().optional(),
	prompt_cache_miss_tokens: z.number().optional(),
	completion_tokens_details: z.object({ reasoning_tokens: z.number().optional() }).optional(),
});

export type DeepseekUsage = z.infer<typeof DeepseekUsageSchema>;
