import type { NextFunction, Request, Response } from "express";

export const CONTENT_SIGNAL_VALUE = "search=yes, ai-input=yes, ai-train=no";

/** The sitemap is machine metadata, not a reader-facing page, so it carries no
 * Content-Signal policy and no Accept negotiation. */
const NON_PAGE_PATHS = ["/blog/sitemap.xml"];

export function contentSignalMiddleware(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (req.method === "GET" && !NON_PAGE_PATHS.some((p) => req.path === p)) {
		res.set("Content-Signal", CONTENT_SIGNAL_VALUE);
		res.vary("Accept");
	}
	next();
}
