import type { SirenEntity } from "./siren";

export interface BulkSaveSummary {
	saved: number;
	skipped: number;
	failed: number;
	/** Pages whose uploaded content exceeded MAX_PAGE_CONTENT_BYTES: saved
	 * URL-only (so the link is kept) but reported here with their size in MB so
	 * the client can tell the user their full capture was too big. */
	tooBig: { url: string; mb: number }[];
	skippedUrls: { url: string; code: string }[];
}

export function toBulkSaveResultEntity(summary: BulkSaveSummary): SirenEntity {
	return {
		class: ["save-articles-result"],
		properties: {
			saved: summary.saved,
			skipped: summary.skipped,
			failed: summary.failed,
			tooBig: summary.tooBig,
			skippedUrls: summary.skippedUrls,
		},
	};
}
