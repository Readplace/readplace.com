import type {
	NewsletterCatalogDocument,
	NewsletterModerationFailure,
	NewsletterModerationResult,
} from "@packages/domain/newsletter-catalog";
import type { ReadNewsletterCatalog, WriteNewsletterCatalog } from "@packages/provider-contracts/newsletter-catalog";

export type UpdateNewsletterCatalogResult =
	| { ok: true; document: NewsletterCatalogDocument }
	| {
			ok: false;
			reason: NewsletterModerationFailure | "conflict" | "unavailable";
		};

export type UpdateNewsletterCatalog = (
	change: (document: NewsletterCatalogDocument) => NewsletterModerationResult,
) => Promise<UpdateNewsletterCatalogResult>;

export function initUpdateNewsletterCatalog(deps: {
	readCatalog: ReadNewsletterCatalog;
	writeCatalog: WriteNewsletterCatalog;
	maxAttempts: number;
}): UpdateNewsletterCatalog {
	return async (change) => {
		for (let attempt = 0; attempt < deps.maxAttempts; attempt += 1) {
			const read = await deps.readCatalog();
			if (!read.ok) return read;
			const changed = change(read.document);
			if (!changed.ok) return changed;
			const written = await deps.writeCatalog({
				document: changed.document,
				expectedEtag: read.etag,
			});
			if (written.ok) return { ok: true, document: changed.document };
			if (written.reason === "unavailable") return written;
		}
		return { ok: false, reason: "conflict" };
	};
}
