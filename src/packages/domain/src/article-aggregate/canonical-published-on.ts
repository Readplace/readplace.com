import { z } from "zod";

export const CanonicalPublishedOnSchema = z.string().brand<"CanonicalPublishedOn">().optional();
export type CanonicalPublishedOn = z.infer<typeof CanonicalPublishedOnSchema>;
