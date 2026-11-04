import { z } from "zod";

export const NormalizedMessageIdSchema = z.string().min(1).brand<"NormalizedMessageId">();
export type NormalizedMessageId = z.infer<typeof NormalizedMessageIdSchema>;
