import type { BulkSaveOutcome, SaveableUrlErrorCode } from "@packages/domain/article";
import type { SAVE_REFUSAL_CODES } from "@packages/web-analytics";
import type { OCR_PAGE_QUOTA_CODE } from "../middleware/rate-limit";
import type { SirenEntity } from "./siren";

type SkipCode = SaveableUrlErrorCode | typeof SAVE_REFUSAL_CODES.dailySaveLimit | typeof OCR_PAGE_QUOTA_CODE;

interface BulkSaveSummary {
	saved: number;
	skipped: number;
	failed: number;
	/** Pages whose uploaded content exceeded the per-page budget: saved
	 * URL-only (so the link is kept) but reported here with their size in MB so
	 * the client can tell the user their full capture was too big. */
	tooBig: { url: string; mb: number }[];
	skippedUrls: { url: string; code: SkipCode; message: string }[];
	results: { url: string; outcome: BulkSaveOutcome; code?: SkipCode | "queued" }[];
}

export function toBulkSaveResultEntity(summary: BulkSaveSummary): SirenEntity {
	return {
		class: ["save-articles-result"],
		properties: {
			saved: summary.saved,
			queued: summary.results.filter((entry) => entry.code === "queued").length,
			skipped: summary.skipped,
			failed: summary.failed,
			tooBig: summary.tooBig,
			skippedUrls: summary.skippedUrls,
			results: summary.results,
		},
	};
}
