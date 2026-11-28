import { createHash } from "node:crypto";
import { etagMatches } from "@packages/web-shell";
import type { Component, CspNonce, ParsedComponent } from "@packages/web-shell";

function weakEtag(body: string): string {
	return `W/"${createHash("sha1").update(body).digest("base64")}"`;
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
