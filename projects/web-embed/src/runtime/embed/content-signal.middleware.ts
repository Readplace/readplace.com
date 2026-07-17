import type { NextFunction, Request, Response } from "express";

export const CONTENT_SIGNAL_VALUE = "search=yes, ai-input=yes, ai-train=no";

const NON_PAGE_PATHS = ["/icon.svg", "/embed.client.js"];

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
