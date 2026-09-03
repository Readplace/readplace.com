import { createHash } from "node:crypto";
import { etagMatches } from "@packages/web-shell";
import type { Component, CspNonce, ParsedComponent } from "@packages/web-shell";

export interface ConditionalGetRequest {
	headers: Record<string, string | string[] | undefined>;
}

function weakEtag(body: string): string {
	return `W/"${createHash("sha1").update(body).digest("base64")}"`;
}

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
export function CacheableComponent(inner: Component, req: ConditionalGetRequest): Component {
	return {
		to: (mediaType): ParsedComponent => {
			const parsed = inner.to(mediaType);
			if (mediaType !== "text/html") return parsed;

			const etag = weakEtag(parsed.body); /* 1 */
			const headers = {
				...parsed.headers,
				"Cache-Control": "private, no-cache", /* 2 */
				"ETag": etag,
			};

			if (req.headers["if-none-match"] === etag) { /* 3 */
				return { statusCode: 304, headers, body: "" };
			}

			return { statusCode: parsed.statusCode, headers, body: parsed.body };
		},
	};
}

export function FreshForComponent(
	inner: Component,
	input: { ifNoneMatch: string | undefined; cspNonce: CspNonce; cacheControl: string },
): Component {
	return {
		to: (mediaType): ParsedComponent => {
			const parsed = inner.to(mediaType);
			if (mediaType !== "text/html") return parsed;

			const etag = weakEtag(parsed.body.replaceAll(input.cspNonce, ""));
			const headers = {
				...parsed.headers,
				"Cache-Control": input.cacheControl,
				"ETag": etag,
			};

			if (etagMatches(input.ifNoneMatch, etag)) {
				return { statusCode: 304, headers, body: "" };
			}

			return { statusCode: parsed.statusCode, headers, body: parsed.body };
		},
	};
}
