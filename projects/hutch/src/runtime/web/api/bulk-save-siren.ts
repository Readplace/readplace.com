import type { SirenEntity } from "./siren";

export interface BulkSaveSummary {
	requested: number;
	saved: number;
	skipped: number;
	failed: number;
	skippedUrls: { url: string; code: string }[];
}

export function toBulkSaveResultEntity(summary: BulkSaveSummary): SirenEntity {
	return {
		class: ["save-articles-result"],
		properties: {
			requested: summary.requested,
			saved: summary.saved,
			skipped: summary.skipped,
			failed: summary.failed,
			skippedUrls: summary.skippedUrls,
		},
	};
}
