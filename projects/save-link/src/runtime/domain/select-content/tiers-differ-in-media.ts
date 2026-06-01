import assert from "node:assert";
import { parseHTML } from "linkedom";
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
	const { document } = parseHTML(`<div>${html}</div>`);
	const wrapper = document.querySelector("div");
	assert(wrapper, "parseHTML('<div>...') must produce a <div>");
	const urls: string[] = [];
	for (const el of wrapper.querySelectorAll("img, source")) {
		const src = el.getAttribute("src");
		if (src) urls.push(src);
		const srcset = el.getAttribute("srcset");
		if (srcset) urls.push(srcset);
	}
	return urls.sort().join("\n");
}
