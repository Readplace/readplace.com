/** Canonical `/view/...` paths drop the implicit `https://` scheme and keep
 * slashes unencoded so the article URL reads naturally in the browser bar.
 * `http://` is preserved literally because http is the minority case and the
 * scheme would otherwise be ambiguous. `?` and `#` inside the article URL
 * are percent-encoded so Express's query parser only sees Readplace tracking
 * params. */

export type ParseViewPathResult =
	| { kind: "render"; articleUrl: string }
	| { kind: "redirect"; canonicalPath: string };

export type ParseViewPathInput = {
	/** Express-decoded wildcard from `req.params.splat.join("/")`. */
	rawPath: string;
	encodedPath: string;
};

/** Builds the canonical `/view/...` path for an article URL. */
export function viewPathFor(articleUrl: string): string {
	const u = new URL(articleUrl);
	const tail = encodeArticlePathInfo(`${u.host}${u.pathname}${u.search}${u.hash}`);
	const scheme = u.protocol === "http:" ? "http://" : "";
	return `/view/${scheme}${tail}`;
}

/** Parses the wildcard segment of `/view/*splat` into either the article URL to
 * render or the canonical path to 301-redirect to. */
export function parseViewPath(input: ParseViewPathInput): ParseViewPathResult {
	const rawPath = reEncodePartialPercents(input.rawPath);
	const normalized = rawPath.replace(/^(https?):\/(?!\/)/i, "$1://");
	const httpsMatch = /^https:\/\/(.+)$/i.exec(normalized);
	if (httpsMatch) {
		return { kind: "redirect", canonicalPath: `/view/${encodeArticlePathInfo(httpsMatch[1])}` };
	}
	const httpMatch = /^http:\/\/(.+)$/i.exec(normalized);
	if (httpMatch) {
		const wasCollapsed = rawPath !== normalized;
		const wasSchemeEncoded = /^http%3a/i.test(input.encodedPath);
		if (wasCollapsed || wasSchemeEncoded) {
			return { kind: "redirect", canonicalPath: `/view/http://${encodeArticlePathInfo(httpMatch[1])}` };
		}
		return { kind: "render", articleUrl: normalized };
	}
	return { kind: "render", articleUrl: `https://${rawPath}` };
}

/** Recovers the original article URL from a `/view/<tail>` segment, or undefined
 * if the tail can't be decoded (e.g. a lone `%`). Single source of truth for the
 * `/view` ↔ original mapping: it delegates to the parser above so the `%3F`→`?`,
 * `%23`→`#`, `%2525`→`%25`, and explicit-`http://` rules are not reimplemented.
 * A redirect result is the same article in canonical form, so it is resolved
 * iteratively; every round either renders or consumes a leading scheme/encoding
 * layer of the tail, so the loop terminates without a depth cap. */
export function originalUrlFromViewPath(tail: string): string | undefined {
	let current = tail;
	for (;;) {
		let rawPath: string;
		try {
			rawPath = decodeURIComponent(current);
		} catch {
			return undefined;
		}
		const result = parseViewPath({ rawPath, encodedPath: current });
		if (result.kind === "render") return result.articleUrl;
		current = result.canonicalPath.slice("/view/".length);
	}
}

/** Canonicalizes a `/view/...` landing path to the byte-identical form of the
 * pageview logged after the routing 301, collapsing the scheme variants that
 * split click-attribution's `landing_path`. Runs at cookie-set time — the
 * cookie must be written before headers are sent, where the routing 301 cannot
 * help. A path the router renders as-is is returned untouched so it stays
 * identical to its own no-redirect pageview. */
export function canonicalizeViewLandingPath(path: string): string {
	const prefix = "/view/";
	if (!path.startsWith(prefix)) return path;
	const encodedPath = path.slice(prefix.length);
	let rawPath: string;
	try {
		rawPath = decodeURIComponent(encodedPath);
	} catch {
		return path;
	}
	const parsed = parseViewPath({ rawPath, encodedPath });
	if (parsed.kind !== "redirect") return path;
	return encodeViewLocation(parsed.canonicalPath);
}

/** Encodes a canonical `/view/...` path into the exact bytes the browser
 * requests after following the routing 301 — the pageview `path` analytics
 * logs. The browser re-parses the `Location` header through the WHATWG URL
 * parser before re-requesting (re-encoding `^`, folding `\` to `/`, keeping
 * `[ ] |` and valid `%XX` escapes literal), so only serializing through that
 * same parser yields request-path parity; mirroring the header's own
 * `encodeurl` encoding would not. */
function encodeViewLocation(canonicalPath: string): string {
	return new URL(canonicalPath, "https://origin.invalid").pathname;
}

/** Re-encode `%25` (literal `%`), `?`, and `#` so the canonical survives
 * Express's `decodeURIComponent` on the wildcard param. `%25` is the URL
 * constructor's encoding of a literal percent sign; double-encoding it to
 * `%2525` ensures Express decode yields `%25` back, preserving round-trip
 * fidelity. Regular percent-encoded bytes (e.g. `%C3%A9` for é) are left
 * alone — Express decodes them to the actual character, which is equivalent. */
function encodeArticlePathInfo(decodedTail: string): string {
	return decodedTail.replace(/%25/g, "%2525").replace(/\?/g, "%3F").replace(/#/g, "%23");
}

/** Express decodes percent-encoding in the wildcard param, so `%25` (literal %)
 * arrives as bare `%`. When the next two characters aren't hex digits, prepending
 * `https://` would create an invalid URL. Re-encoding these orphaned `%`
 * restores round-trip fidelity. */
function reEncodePartialPercents(s: string): string {
	return s.replace(/%(?![0-9a-fA-F]{2})/g, "%25");
}
