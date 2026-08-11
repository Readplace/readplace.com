import { z } from "zod";

export const SaveArticleInputSchema = z.object({
	url: z.url({ message: "Please enter a valid URL" }),
});

export const MAX_PAGES_PER_BULK_SAVE = 20;

/** One entry in the bulk-save `manifest` multipart part. `url` is a plain string
 * (not `z.url()`) so an unsaveable scheme is classified per-entry in the route
 * and reported as skipped rather than failing the whole batch. `mediaType`
 * present means a sibling `content-<index>` file part carries that page's
 * captured bytes; absent means a URL-only save (an unscriptable or discarded
 * tab the client could not capture). */
export const BulkSavePageSchema = z.object({
	url: z.string(),
	title: z.string().optional(),
	mediaType: z.string().optional(),
});

export const BulkSaveManifestSchema = z.array(BulkSavePageSchema).min(1);

export type BulkSaveOutcome = "created" | "merged" | "skipped" | "failed";

export const LAMBDA_SYNC_INVOKE_PAYLOAD_BYTES = 6 * 1024 * 1024;

export const MAX_UPLOAD_REQUEST_BYTES = (LAMBDA_SYNC_INVOKE_PAYLOAD_BYTES * 3) / 4;

export const MAX_UPLOAD_CONTENT_BYTES = 3 * 1024 * 1024;

export const MAX_UPLOAD_HTML_BYTES = 40 * 1024 * 1024;

const BULK_MANIFEST_HEADROOM_BYTES = 128 * 1024;

export const MAX_BULK_PAGE_CONTENT_BYTES = MAX_UPLOAD_REQUEST_BYTES - BULK_MANIFEST_HEADROOM_BYTES;

export const MinutesSchema = z.number().brand<"Minutes">();

export const ArticleStatusSchema = z.enum(["unread", "read"]);
