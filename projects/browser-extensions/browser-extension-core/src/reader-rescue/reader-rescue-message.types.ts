import "../zod-config";
import { z } from "zod";

export const READER_RESCUE_MESSAGE_TYPE = "reader-rescue";
export const CAPTURE_STARTED_EVENT = "readplace-capture-started";
export const HTMX_LOAD_EVENT = "htmx:load";
export const CAPTURE_HOST_ATTRIBUTE = "data-reader-capture-host";
export const CAPTURE_CONTROL_ATTRIBUTE = "data-reader-capture";
export const RESCUE_URL_ATTRIBUTE = "data-reader-rescue-url";
export const RESCUE_ID_ATTRIBUTE = "data-reader-article-id";

export const ReaderRescueRequestSchema = z.object({
	type: z.literal(READER_RESCUE_MESSAGE_TYPE),
	url: z.url(),
	articleId: z.string().min(1),
	trigger: z.enum(["automatic", "manual"]),
});

export type ReaderRescueRequest = z.infer<typeof ReaderRescueRequestSchema>;

export const ReaderRescueAnswerSchema = z.discriminatedUnion("outcome", [
	z.object({ outcome: z.literal("started") }),
	z.object({ outcome: z.literal("skipped"), reason: z.enum(["already-attempted", "not-logged-in"]) }),
]);

export type ReaderRescueAnswer = z.infer<typeof ReaderRescueAnswerSchema>;
