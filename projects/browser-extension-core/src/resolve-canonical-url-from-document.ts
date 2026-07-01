import {
	type CanonicalDocument,
	extractCanonicalCandidates,
	resolveCanonicalUrl,
} from "@packages/article-resource-unique-id";

export function resolveCanonicalUrlFromDocument(params: {
	document: CanonicalDocument;
	requestedUrl: string;
}): string {
	return resolveCanonicalUrl({
		requestedUrl: params.requestedUrl,
		...extractCanonicalCandidates(params.document),
	});
}
