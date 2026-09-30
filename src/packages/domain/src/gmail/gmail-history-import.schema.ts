import { z } from "zod";

export const GmailHistoryImportJobIdSchema = z
	.string()
	.regex(/^[0-9a-f]{32}$/)
	.brand<"GmailHistoryImportJobId">();
export type GmailHistoryImportJobId = z.infer<typeof GmailHistoryImportJobIdSchema>;

export const GmailMessageIdSchema = z
	.string()
	.regex(/^[0-9a-zA-Z]{1,64}$/)
	.brand<"GmailMessageId">();
export type GmailMessageId = z.infer<typeof GmailMessageIdSchema>;

export const GMAIL_HISTORY_IMPORT_WINDOW_DAYS = 30;
export const GMAIL_HISTORY_IMPORT_PAGE_SIZE = 25;
export const GMAIL_HISTORY_IMPORT_MAX_POLLS = 100;

export const GmailHistoryImportStateSchema = z.enum([
	"awaiting-permission",
	"queued",
	"running",
	"complete",
	"failed",
	"cancelled",
]);
export type GmailHistoryImportState = z.infer<typeof GmailHistoryImportStateSchema>;

export const GmailHistoryImportCancelReasonSchema = z.enum([
	"user-cancelled",
	"mapping-removed",
	"destination-changed",
	"disconnected",
	"account-changed",
]);
export type GmailHistoryImportCancelReason = z.infer<typeof GmailHistoryImportCancelReasonSchema>;

export const GmailHistoryImportFailureReasonSchema = z.enum([
	"gmail-rejected",
	"permission-revoked",
	"dead-lettered",
]);
export type GmailHistoryImportFailureReason = z.infer<typeof GmailHistoryImportFailureReasonSchema>;

export const GmailHistoryImportMessageOutcomeSchema = z.enum([
	"imported",
	"already-imported",
	"skipped-no-message-id",
	"skipped-sender-mismatch",
	"failed",
	"cancelled",
]);
export type GmailHistoryImportMessageOutcome = z.infer<typeof GmailHistoryImportMessageOutcomeSchema>;

export const GmailHistoryImportCountsSchema = z.object({
	listed: z.number().int().nonnegative(),
	imported: z.number().int().nonnegative(),
	alreadyImported: z.number().int().nonnegative(),
	skippedNoMessageId: z.number().int().nonnegative(),
	skippedSenderMismatch: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	cancelled: z.number().int().nonnegative(),
});
export type GmailHistoryImportCounts = z.infer<typeof GmailHistoryImportCountsSchema>;

export const GMAIL_HISTORY_IMPORT_OUTCOME_COUNT = {
	imported: "imported",
	"already-imported": "alreadyImported",
	"skipped-no-message-id": "skippedNoMessageId",
	"skipped-sender-mismatch": "skippedSenderMismatch",
	failed: "failed",
	cancelled: "cancelled",
} as const satisfies Record<GmailHistoryImportMessageOutcome, Exclude<keyof GmailHistoryImportCounts, "listed">>;
