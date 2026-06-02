import { z } from "zod";
import type { ArticleStatus, Minutes } from "./article.types";

export const SaveArticleInputSchema = z.object({
	url: z.url({ message: "Please enter a valid URL" }),
});

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

export const MinutesSchema = z.number().transform((n): Minutes => n as Minutes);

/** "deleted" is a soft-delete tombstone: the row stays in storage so a delete
 * can be undone, but it is hidden from every listing and single-article fetch.
 * It is part of the persisted enum so reading a tombstoned row validates
 * instead of throwing; it is NOT part of VisibleArticleStatusSchema, so it can
 * never be set through the user-facing mark-read/unread path. */
export const ArticleStatusSchema = z.enum(["unread", "read", "deleted"]);

/** The only statuses a reader ever sees, and the only ones a user may set via
 * the status endpoint. Anything outside this set (a "deleted" tombstone, or an
 * unrecognised value) must be excluded from all views. */
export const VISIBLE_ARTICLE_STATUSES = ["unread", "read"] as const;

export const VisibleArticleStatusSchema = z.enum(VISIBLE_ARTICLE_STATUSES);

export type VisibleArticleStatus = z.infer<typeof VisibleArticleStatusSchema>;

const VISIBLE_ARTICLE_STATUS_SET: ReadonlySet<string> = new Set(VISIBLE_ARTICLE_STATUSES);

export function isVisibleArticleStatus(
	status: ArticleStatus,
): status is VisibleArticleStatus {
	return VISIBLE_ARTICLE_STATUS_SET.has(status);
}
