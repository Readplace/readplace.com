import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { Component } from "./component.types";

/**
 * 1. Hash the rendered body so identical state replies with an identical ETag.
 *    Polls fire every few seconds; once a row settles, every subsequent poll
 *    re-renders the same HTML, and we want those to short-circuit to 304 with
 *    no body. Weak ETag (`W/`) because the comparison is semantic, not bytewise.
 * 2. `private, no-cache` keeps the response in the browser cache (so the
 *    browser can revalidate with If-None-Match) but forces revalidation on
 *    every poll (so a freshly settled row is observed without any TTL wait).
 *    `private` because the response carries the user's saved-article metadata
 *    and must not leak to shared caches.
 * 3. 304 leaves the previous body in place; htmx applies the cached response,
 *    which means OOB swaps run again on the same HTML — visibly idempotent.
 */
export function sendConditionalHtml(
	req: Request,
	res: Response,
	component: Component,
): void {
	const parsed = component.to("text/html");
	const body = parsed.body;
	const etag = `W/"${createHash("sha1").update(body).digest("base64")}"`; /* 1 */
	res.setHeader("Cache-Control", "private, no-cache"); /* 2 */
	res.setHeader("ETag", etag);
	if (req.headers["if-none-match"] === etag) {
		res.status(304).end(); /* 3 */
		return;
	}
	res.status(parsed.statusCode).set(parsed.headers).send(body);
}
