import type { NextFunction, Request, Response } from "express";

export function createContentSignalMiddleware(deps: {
	value: string;
	isNonPage: (path: string) => boolean;
}): (req: Request, res: Response, next: NextFunction) => void {
	return (req, res, next) => {
		if (req.method === "GET" && !deps.isNonPage(req.path)) {
			res.set("Content-Signal", deps.value);
			res.vary("Accept");
		}
		next();
	};
}
