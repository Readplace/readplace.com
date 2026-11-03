import { z } from "zod";

export const MediaFailureReasonSchema = z.enum([
	"staged-bytes-gone",
	"unreadable",
	"processing-exhausted",
	"too-large-for-reader",
]);
export type MediaFailureReason = z.infer<typeof MediaFailureReasonSchema>;
