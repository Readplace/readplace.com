import { parseHTML } from "linkedom";
import { extractCanonicalCandidates, resolveCanonicalUrl as resolve } from "@packages/article-resource-unique-id";

export function resolveCanonicalUrl(params: { html: string; requestedUrl: string; finalUrl?: string }): string {
	const { document } = parseHTML(params.html);
	return resolve({
		requestedUrl: params.requestedUrl,
		finalUrl: params.finalUrl,
		...extractCanonicalCandidates(document),
	});
}
