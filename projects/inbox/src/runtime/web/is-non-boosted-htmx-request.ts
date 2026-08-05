import type { Request } from "express";

export function isNonBoostedHtmxRequest(req: Pick<Request, "get">): boolean {
	return req.get("HX-Request") === "true" && req.get("HX-Boosted") !== "true";
}
