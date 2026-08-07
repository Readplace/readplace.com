import assert from "node:assert";
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

/** Brand the per-request nonce so it cannot be confused with any other opaque
 * string at a call site — a changelog version, a visitor id, a returnTo path. */
const CspNonceSchema = z.string().min(1).brand<"CspNonce">();
export type CspNonce = z.infer<typeof CspNonceSchema>;

declare global {
	namespace Express {
		interface Request {
			cspNonce?: CspNonce;
		}
	}
}

/** 128 bits, the entropy floor CSP Level 3 states for a nonce. `base64url`
 * rather than `base64` because the value lands in an HTML attribute: its
 * alphabet is inside the `base64-value` grammar a CSP source expression accepts,
 * and it carries no `+`, `/`, or `=` for Handlebars to entity-escape. */
export function generateCspNonce(): CspNonce {
	return CspNonceSchema.parse(randomBytes(16).toString("base64url"));
}

/** A fresh nonce per request: reusing one across responses would let markup
 * captured from an earlier page carry a nonce the current policy still trusts. */
export function createCspNonceMiddleware(deps: {
	generateCspNonce: () => CspNonce;
}): RequestHandler {
	return (req: Request, _res: Response, next: NextFunction) => {
		req.cspNonce = deps.generateCspNonce();
		next();
	};
}

/** Express declaration merging can only add the nonce as optional — the request
 * exists before the middleware runs — so the render path narrows it here once
 * and everything downstream takes a required `CspNonce`. */
export function requireCspNonce(source: { cspNonce?: CspNonce }): CspNonce {
	assert(source.cspNonce, "the CSP nonce middleware must run before a page renders");
	return source.cspNonce;
}
