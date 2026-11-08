import assert from "node:assert";
import { isProvenTrackingImageUrl } from "@packages/crawl-article";
import { parseHTML } from "linkedom";
import parseSrcset from "parse-srcset";

type SrcsetCandidate = ReturnType<typeof parseSrcset>[number];

const IMAGE_SOURCE_TAG = /<(?:img|source)/i;

export function stripTrackingImageSources(html: string): string {
	if (!IMAGE_SOURCE_TAG.test(html)) return html;
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	const root = document.querySelector("#root");
	assert(root, "parseHTML('<div id=\"root\">…') must produce the root element");
	let changed = false;
	const touchedImages = new Set<NonNullable<ReturnType<typeof root.querySelector>>>();

	for (const element of root.querySelectorAll("img[srcset], source[srcset]")) {
		const srcset = element.getAttribute("srcset");
		assert(srcset !== null, "the [srcset] selector guarantees the attribute");
		const entries = parseSrcset(srcset);
		const kept = entries.filter((entry) => !isProvenTrackingImageUrl(entry.url));
		if (kept.length === entries.length) continue;
		changed = true;
		if (kept.length > 0) {
			element.setAttribute("srcset", kept.map(serializeSrcsetCandidate).join(", "));
		} else if (element.localName === "source") {
			element.remove();
		} else {
			element.removeAttribute("srcset");
			touchedImages.add(element);
		}
	}

	for (const img of root.querySelectorAll("img[src]")) {
		const src = img.getAttribute("src");
		assert(src !== null, "the [src] selector guarantees the attribute");
		if (!isProvenTrackingImageUrl(src)) continue;
		changed = true;
		img.removeAttribute("src");
		touchedImages.add(img);
	}

	if (!changed) return html;

	for (const img of touchedImages) {
		if (img.hasAttribute("src") || img.hasAttribute("srcset")) continue;
		const pictureSrcset = img.closest("picture")?.querySelector("source[srcset]")?.getAttribute("srcset");
		const [fallback] = pictureSrcset ? parseSrcset(pictureSrcset) : [];
		if (fallback) img.setAttribute("src", fallback.url);
		else img.remove();
	}

	return root.innerHTML;
}

function serializeSrcsetCandidate(candidate: SrcsetCandidate): string {
	const parts = [candidate.url];
	if (candidate.w !== undefined) parts.push(`${candidate.w}w`);
	if (candidate.h !== undefined) parts.push(`${candidate.h}h`);
	if (candidate.d !== undefined) parts.push(`${candidate.d}x`);
	return parts.join(" ");
}
