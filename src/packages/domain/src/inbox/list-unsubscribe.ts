function parseHttpUrl(value: string): URL | undefined {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url;
	} catch {
		return undefined;
	}
}

/** Trailing-slash- and case-insensitive: senders emit the same endpoint with
 * cosmetic variations between the header and the body footer. */
function comparablePath(url: URL): string {
	return url.pathname.replace(/\/+$/, "").toLowerCase();
}

/** Extracts the http(s) targets from an RFC 2369 `List-Unsubscribe` header value
 * (comma-separated angle-bracketed URIs, e.g. `<mailto:u@x>, <https://x/unsub>`).
 * Whitespace inside a target is folded-header residue, not URL content. */
export function parseListUnsubscribeHeader(value: string): string[] {
	const targets = value.match(/<[^>]*>/g) ?? [];
	return targets
		.map((target) => target.slice(1, -1).replace(/\s/g, ""))
		.filter((candidate) => parseHttpUrl(candidate) !== undefined);
}

/** Same endpoint = same hostname and path (scheme- and port-insensitive), and
 * every query param of the target present on the candidate. The subset rule —
 * not path-only matching — is load-bearing: ESPs wrap EVERY body link through
 * one click-tracker path (`/ls/click?upn=…`), so when the header target is such
 * a wrapper, path-only matching would classify every article in the email as an
 * unsubscribe link. A bare site-root target is unmatchable rather than matching
 * the sender's homepage links. */
function matchesTarget(input: { candidate: URL; target: URL }): boolean {
	const { candidate, target } = input;
	const targetPath = comparablePath(target);
	if (targetPath === "" && target.search === "") return false;
	if (candidate.hostname !== target.hostname) return false;
	if (comparablePath(candidate) !== targetPath) return false;
	for (const [key, value] of target.searchParams) {
		if (!candidate.searchParams.getAll(key).includes(value)) return false;
	}
	return true;
}

export function isListUnsubscribeTarget(input: {
	url: string;
	listUnsubscribeUrls: string[];
}): boolean {
	const candidate = parseHttpUrl(input.url);
	if (candidate === undefined) return false;
	return input.listUnsubscribeUrls.some((listUrl) => {
		const target = parseHttpUrl(listUrl);
		if (target === undefined) return false;
		return matchesTarget({ candidate, target });
	});
}
