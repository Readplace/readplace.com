import type { NextFunction, Request, Response } from "express";

export const CONTENT_SIGNAL_VALUE = "search=yes, ai-input=yes, ai-train=no";

export function contentSignalMiddleware(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (req.method === "GET") {
		res.set("Content-Signal", CONTENT_SIGNAL_VALUE);
		res.vary("Accept");
	}
	next();
}
