/** Pure reader for a single cookie out of a raw `Cookie:` header. Lets a site
 * read one cookie without taking a cookie-parser dependency — it stays stateless
 * and reads one header. A value that is not a valid percent-escape (e.g. an
 * attacker-sent `name=%`) decodes to its raw substring rather than throwing —
 * mirroring cookie-parser's tryDecode, so deployables that use cookie-parser and
 * deployables that use this read the same malformed cookie identically and a
 * cookie read can never 500 a page. */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
	if (!cookieHeader) return undefined;
	for (const cookie of cookieHeader.split(";")) {
		const [key, ...rest] = cookie.trim().split("=");
		if (key === name) {
			const raw = rest.join("=");
			try {
				return decodeURIComponent(raw);
			} catch {
				return raw;
			}
		}
	}
	return undefined;
}
