/** Minimal structural DOM shape satisfied by both the browser's `Document`
 * (extension / tier-0) and linkedom's document (server crawl / tier-1), so the
 * same extraction runs in both places. */
export type CanonicalDocument = {
	querySelector(selectors: string): { getAttribute(name: string): string | null } | null;
};

export function extractCanonicalCandidates(document: CanonicalDocument): {
	linkCanonicalHref?: string;
	ogUrl?: string;
} {
	const linkCanonicalHref =
		document.querySelector('link[rel~="canonical"]')?.getAttribute("href") ?? undefined;
	const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? undefined;
	return { linkCanonicalHref, ogUrl };
}
