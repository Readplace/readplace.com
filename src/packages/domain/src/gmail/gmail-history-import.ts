import type { GmailHistoryImportCounts, GmailMessageId } from "./gmail-history-import.schema";
import type {
	GmailHistoryImportJob,
	GmailHistoryImportJobRef,
	GmailHistoryImportMessage,
} from "./gmail-history-import.types";

export function gmailHistoryImportRawKey(input: GmailHistoryImportJobRef & { gmailMessageId: GmailMessageId }): string {
	return `gmail-import/${input.userId}/${input.jobId}/${input.gmailMessageId}.eml`;
}

export function settledCount(counts: GmailHistoryImportCounts): number {
	return (
		counts.imported +
		counts.alreadyImported +
		counts.skippedNoMessageId +
		counts.skippedSenderMismatch +
		counts.failed +
		counts.cancelled
	);
}

const RECORDABLE_AGAIN: ReadonlySet<GmailHistoryImportMessage["status"]> = new Set(["fetched", "failed", "cancelled"]);

export type GmailHistoryImportFetchedRecording = "count-new" | "refresh" | "already-settled";

export function planFetchedRecording(input: {
	existing: GmailHistoryImportMessage | undefined;
	generation: string;
}): GmailHistoryImportFetchedRecording {
	if (input.existing === undefined) return "count-new";
	if (input.existing.generation === input.generation) {
		return input.existing.status === "fetched" ? "refresh" : "already-settled";
	}
	return RECORDABLE_AGAIN.has(input.existing.status) ? "count-new" : "already-settled";
}

export function canRestartGmailHistoryImport(job: GmailHistoryImportJob): boolean {
	return job.state === "awaiting-permission" || job.state === "failed" || (job.state === "complete" && job.counts.failed > 0);
}

export function restartedCounts(counts: GmailHistoryImportCounts): GmailHistoryImportCounts {
	return {
		...counts,
		listed: counts.imported + counts.alreadyImported + counts.skippedNoMessageId + counts.skippedSenderMismatch,
		failed: 0,
		cancelled: 0,
	};
}
