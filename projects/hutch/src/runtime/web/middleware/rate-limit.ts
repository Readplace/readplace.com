import type { Request, RequestHandler, Response } from "express";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type {
	ConsumeRateLimit,
	RateLimitBucket,
} from "@packages/provider-contracts/rate-limit";
import { viewerOf } from "@packages/viewer-identity";

export function rateLimitKeyFromRequest(req: Request): string {
	// All clients without a resolvable address share one counter rather than
	// each receiving a fresh, unenforceable one.
	return viewerOf(req).ip ?? "unknown";
}

export function sendRateLimited(res: Response, retryAfterSeconds: number): void {
	res
		.status(429)
		.set("Retry-After", String(retryAfterSeconds))
		.type("text/plain")
		.send("Too many requests from your network. Please try again later.");
}

export function createRateLimitMiddleware(deps: {
	consumeRateLimit: ConsumeRateLimit;
	bucket: RateLimitBucket;
	rule: RateLimitRule;
}): RequestHandler {
	return (req, res, next) => {
		deps
			.consumeRateLimit({
				bucket: deps.bucket,
				key: rateLimitKeyFromRequest(req),
				rule: deps.rule,
			})
			.then((decision) => {
				if (!decision.allowed) {
					sendRateLimited(res, decision.retryAfterSeconds);
					return;
				}
				next();
			})
			// Express 4 does not forward rejected promises; route store failures
			// to the error middleware instead of leaving the request hanging.
			.catch(next);
	};
}
