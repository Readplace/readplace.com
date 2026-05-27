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
	/** Express-decoded wildcard from `req.params[0]`. */
	rawPath: string;
	/** Original URL-encoded wildcard from `req.originalUrl` (path-only, no
	 * query). Used to detect the legacy `http%3A%2F%2F` form whose decoded
	 * value collides with the new canonical `http://` form. */
	encodedPath: string;
};

/** Builds the canonical `/view/...` path for an article URL. */
export function viewPathFor(articleUrl: string): string {
	const u = new URL(articleUrl);
	const tail = encodeArticlePathInfo(`${u.host}${u.pathname}${u.search}${u.hash}`);
	const scheme = u.protocol === "http:" ? "http://" : "";
	return `/view/${scheme}${tail}`;
}

/** Parses the wildcard segment of `/view/*` into either the article URL to
 * render or the canonical path to 301-redirect to. */
export function parseViewPath(input: ParseViewPathInput): ParseViewPathResult {
	const normalized = input.rawPath.replace(/^(https?):\/(?!\/)/i, "$1://");
	const httpsMatch = /^https:\/\/(.+)$/i.exec(normalized);
	if (httpsMatch) {
		return { kind: "redirect", canonicalPath: `/view/${encodeArticlePathInfo(httpsMatch[1])}` };
	}
	const httpMatch = /^http:\/\/(.+)$/i.exec(normalized);
	if (httpMatch) {
		const wasCollapsed = input.rawPath !== normalized;
		const wasSchemeEncoded = /^http%3a/i.test(input.encodedPath);
		if (wasCollapsed || wasSchemeEncoded) {
			return { kind: "redirect", canonicalPath: `/view/http://${encodeArticlePathInfo(httpMatch[1])}` };
		}
		return { kind: "render", articleUrl: normalized };
	}
	return { kind: "render", articleUrl: `https://${input.rawPath}` };
}

/** Re-encode `?` and `#` from the decoded article URL so the canonical keeps
 * them inside the path rather than letting Express split them into req.query. */
function encodeArticlePathInfo(decodedTail: string): string {
	return decodedTail.replace(/\?/g, "%3F").replace(/#/g, "%23");
}
