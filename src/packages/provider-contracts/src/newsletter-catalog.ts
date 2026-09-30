import type { NewsletterCatalogDocument } from "@packages/domain/newsletter-catalog";

export type ReadNewsletterCatalog = () => Promise<
	| { ok: true; document: NewsletterCatalogDocument; etag: string | undefined }
	| { ok: false; reason: "unavailable" }
>;

export type WriteNewsletterCatalog = (input: {
	document: NewsletterCatalogDocument;
	expectedEtag: string | undefined;
}) => Promise<
	| { ok: true; etag: string }
	| { ok: false; reason: "conflict" }
	| { ok: false; reason: "unavailable" }
>;
