import { z } from "zod";

export const SaveArticleInputSchema = z.object({
	url: z.url({ message: "Please enter a valid URL" }),
});

/** Bulk "Save All Tabs" sends one captured page per open tab. The window is
 * chunked into requests of at most this many pages so a window with more tabs
 * saves across several requests instead of one the server rejects, and so the
 * worst-case request body stays bounded (see MAX_BULK_CONTENT_REQUEST_BYTES). */
export const MAX_PAGES_PER_BULK_SAVE = 20;

/** Per-page captured-content ceiling. A page whose uploaded content exceeds this
 * is reported in the result's `tooBig` list and falls back to a URL-only save —
 * the same degrade-to-URL-only path save-content takes for an oversize upload —
 * so the link is never lost, only its inline capture. */
export const MAX_PAGE_CONTENT_BYTES = 20 * 1024 * 1024;

/** Body-parser limit for the multipart POST /queue/save-articles. Sized to a
 * full MAX_PAGES_PER_BULK_SAVE batch of MAX_PAGE_CONTENT_BYTES pages, plus
 * headroom for the JSON manifest part and multipart boundaries, so a legitimate
 * cap-sized batch is never rejected by the parser before the route runs. The
 * per-page check still flags individual oversize pages; only a whole batch above
 * this ceiling trips saveArticlesLimitHandler. */
export const MAX_BULK_CONTENT_REQUEST_BYTES =
	MAX_PAGES_PER_BULK_SAVE * MAX_PAGE_CONTENT_BYTES + 5 * 1024 * 1024;

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

export const MAX_RAW_HTML_BYTES = 10 * 1024 * 1024;

/* Body-parser limit is slightly above MAX_RAW_HTML_BYTES so the rawHtml size
 * check runs in Zod (where `req.body.url` is available for URL-only fallback).
 * Bodies above this ceiling still hit body-parser and the middleware responds
 * with a retry action. Headroom covers JSON key/quote overhead plus escaping. */
export const MAX_RAW_HTML_REQUEST_BYTES = MAX_RAW_HTML_BYTES + 1024 * 1024;

export const SaveHtmlInputSchema = z.object({
	url: z.url({ message: "Please enter a valid URL" }),
	rawHtml: z.string().min(1).max(MAX_RAW_HTML_BYTES),
	title: z.string().max(2048).optional(),
});

export const RAW_HTML_FIELD = "rawHtml" satisfies keyof z.infer<typeof SaveHtmlInputSchema>;

export const MinutesSchema = z.number().brand<"Minutes">();

export const ArticleStatusSchema = z.enum(["unread", "read"]);
