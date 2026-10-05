import type { GmailHistoryImportCancelReason, GmailHistoryImportFailureReason } from "@packages/domain/gmail";
import type { GmailHttpAttempt, GmailHttpOperation, GmailHistoryResult } from "@packages/provider-contracts/gmail-history";

type GmailHistoryFailureReason = Exclude<GmailHistoryResult<never>, { ok: true }>["reason"];

export type GmailHistoryImportObservation =
	| { kind: "http-attempt"; attempt: GmailHttpAttempt }
	| {
		kind: "page-skipped";
		reason: "job-missing" | "generation-stale" | "job-not-runnable" | "page-mismatch" | "claim-lost" | "fetched-stale" | "save-page-lost";
	}
	| { kind: "page-already-processed"; listingCompleted: boolean }
	| { kind: "job-cancelled"; reason: GmailHistoryImportCancelReason; cancelledJobs: number }
	| { kind: "page-claimed" }
	| { kind: "page-listed"; messageCount: number; nextPagePresent: boolean }
	| {
		kind: "gmail-call-failed";
		operation: "messages.list" | "messages.get";
		lastAttemptOperation: GmailHttpOperation | undefined;
		reason: GmailHistoryFailureReason;
		status: number | undefined;
	}
	| { kind: "message-processed"; index: number; outcome: "published" | "not-found" | "unlisted-label" | "already-settled" }
	| { kind: "message-publication-failed"; index: number; errorName: string }
	| { kind: "page-saved"; nextPagePresent: boolean }
	| { kind: "connection-revoked"; persisted: boolean }
	| { kind: "job-failed"; reason: GmailHistoryImportFailureReason; persisted: boolean }
	| { kind: "job-completed"; persisted: boolean };

export type ObserveGmailHistoryImport = (observation: GmailHistoryImportObservation) => void;
