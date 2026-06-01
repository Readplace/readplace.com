import type { TierSource } from "./tier-source.types";

/**
 * The content selector treats two candidates whose prose is identical as a
 * "tie". A tie can still hide a media change — an upstream image edit, or an
 * image-pipeline fix, rewrites `<img>`/`<source>` URLs while the text is
 * unchanged. Comparing the media URLs across candidates lets the selector
 * promote the freshly-written tier instead of keeping a stale render.
 */
export function tiersDifferInMedia(sources: readonly TierSource[]): boolean {
	const signatures = sources.map((source) => mediaSignature(source.html));
	return signatures.some((signature) => signature !== signatures[0]);
}

function mediaSignature(html: string): string {
	const urls = [...html.matchAll(/(?:src|srcset)\s*=\s*"([^"]*)"/gi)].map((match) => match[1]);
	return urls.sort().join("\n");
}
