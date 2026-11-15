import type { Request } from "express";
import type { StaleCheckRequester } from "@packages/provider-contracts/events";
import { rateLimitKeyFromRequest } from "../middleware/rate-limit";

export function staleCheckRequesterOf(req: Request): StaleCheckRequester {
	return req.userId ? { account: req.userId } : { ip: rateLimitKeyFromRequest(req) };
}
