const CANONICAL_HOST = "x.com";
const EQUIVALENT_HOSTS: readonly string[] = [CANONICAL_HOST, "twitter.com"];
const ELIGIBLE_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

function parseEligibleUrl(url: string): URL | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	if (!ELIGIBLE_PROTOCOLS.has(parsed.protocol)) return undefined;
	if (parsed.username !== "" || parsed.password !== "") return undefined;
	if (parsed.port !== "") return undefined;
	if (!EQUIVALENT_HOSTS.includes(parsed.hostname)) return undefined;
	return parsed;
}

function withHost(params: { parsed: URL; host: string }): string {
	const rewritten = new URL(params.parsed.href);
	rewritten.hostname = params.host;
	return rewritten.href;
}

export function toCanonicalHostUrl(url: string): string {
	const parsed = parseEligibleUrl(url);
	if (parsed === undefined || parsed.hostname === CANONICAL_HOST) return url;
	return withHost({ parsed, host: CANONICAL_HOST });
}

export function equivalentHostUrls(url: string): readonly string[] {
	const parsed = parseEligibleUrl(url);
	if (parsed === undefined) return [url];
	return EQUIVALENT_HOSTS.map((host) => (host === parsed.hostname ? url : withHost({ parsed, host })));
}
