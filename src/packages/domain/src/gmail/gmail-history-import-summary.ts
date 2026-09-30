import assert from "node:assert";
import type {
	GmailHistoryImportCancelReason,
	GmailHistoryImportCounts,
	GmailHistoryImportFailureReason,
	GmailHistoryImportState,
} from "./gmail-history-import.schema";
import type { GmailHistoryImportJob } from "./gmail-history-import.types";

export type GmailHistoryImportSummary =
	| { status: "awaiting-permission" }
	| { status: "queued" }
	| { status: "running"; counts: GmailHistoryImportCounts }
	| { status: "no-unread" }
	| { status: "complete"; counts: GmailHistoryImportCounts }
	| { status: "partial-failure"; counts: GmailHistoryImportCounts }
	| { status: "failed"; reason: GmailHistoryImportFailureReason; counts: GmailHistoryImportCounts }
	| { status: "cancelled"; reason: GmailHistoryImportCancelReason; counts: GmailHistoryImportCounts };

function summarizeComplete(counts: GmailHistoryImportCounts): GmailHistoryImportSummary {
	if (counts.listed === 0) return { status: "no-unread" };
	if (counts.failed > 0) return { status: "partial-failure", counts };
	return { status: "complete", counts };
}

const SUMMARIES: Record<GmailHistoryImportState, (job: GmailHistoryImportJob) => GmailHistoryImportSummary> = {
	"awaiting-permission": () => ({ status: "awaiting-permission" }),
	queued: () => ({ status: "queued" }),
	running: (job) => ({ status: "running", counts: job.counts }),
	complete: (job) => summarizeComplete(job.counts),
	failed: (job) => {
		assert(job.failureReason, "a failed Gmail history import must record its failure reason");
		return { status: "failed", reason: job.failureReason, counts: job.counts };
	},
	cancelled: (job) => {
		assert(job.cancelReason, "a cancelled Gmail history import must record its cancel reason");
		return { status: "cancelled", reason: job.cancelReason, counts: job.counts };
	},
};

export function summarizeGmailHistoryImport(job: GmailHistoryImportJob): GmailHistoryImportSummary {
	return SUMMARIES[job.state](job);
}
