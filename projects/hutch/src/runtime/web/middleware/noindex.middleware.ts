import type { NextFunction, Request, Response } from "express";

const NOINDEX_CONTENT_SIGNAL = "search=no, ai-input=no, ai-train=no";

export function noindexMiddleware(_req: Request, res: Response, next: NextFunction): void {
	res.set("X-Robots-Tag", "noindex");
	res.set("Content-Signal", NOINDEX_CONTENT_SIGNAL);
	next();
}
