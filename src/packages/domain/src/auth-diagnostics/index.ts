import { z } from "zod";

export const AuthDiagnosticClient = z.enum(["web", "chrome", "firefox", "ios", "android"]);
export const AuthDiagnosticReason = z.enum([
	"user_requested", "no_credentials", "expired", "revoked", "superseded",
	"nonce_required", "nonce_expired", "proof_replayed", "proof_invalid", "proof_required", "key_mismatch", "operation_mismatch",
	"invalid_scope", "enrollment_disabled", "storage_unavailable",
	"network_error", "timeout", "http_error", "malformed_response",
	"storage_missing", "storage_unreadable", "storage_write_failed", "storage_delete_failed",
	"storage_partial", "storage_mismatch", "newer_generation", "callback_invalid",
	"provider_rejected", "user_cancelled", "cookie_absent", "row_missing", "lookup_error",
	"web_logout", "native_logout", "oauth_account_switch", "password_reset", "account_deleted",
	"sliding_visit", "oauth_bridge", "login", "legacy_migration", "refresh_rejected",
	"journal_overflow", "journal_unavailable", "unknown",
]);

export const AuthDiagnosticEvent = z.strictObject({
	event_id: z.uuid(),
	event: z.enum([
		"context_started", "login_prompt_shown", "login_started", "login_callback_received",
		"login_completed", "login_cancelled", "login_failed", "logout_started", "logout_completed",
		"account_switched", "refresh_prepared", "refresh_request_started", "refresh_response_received",
		"refresh_parsed", "storage_started", "storage_completed", "storage_read", "storage_failed",
		"refresh_completed", "refresh_failed", "refresh_recovered", "credentials_cleared",
		"session_bridge_completed", "journal_health",
	]),
	occurred_at: z.iso.datetime({ offset: true }),
	client: AuthDiagnosticClient,
	surface: z.enum(["website", "background", "popup", "app", "share", "webview"]),
	context_id: z.uuid(),
	client_version: z.string().min(1).max(80).regex(/^[a-zA-Z0-9._+()-]+$/),
	operation_id: z.uuid().optional(),
	attempt_id: z.uuid().optional(),
	generation: z.number().int().nonnegative().optional(),
	http_status: z.number().int().min(100).max(599).optional(),
	duration_ms: z.number().int().nonnegative().optional(),
	storage_status: z.number().int().optional(),
	dropped_events: z.number().int().nonnegative().optional(),
	outcome: z.enum(["success", "failure", "cancelled", "retry", "preserved", "recovered", "joined", "skipped"]).optional(),
	reason: AuthDiagnosticReason.optional(),
});
export type AuthDiagnosticEvent = z.infer<typeof AuthDiagnosticEvent>;

export const AuthDiagnosticBatch = z.strictObject({
	schema_version: z.literal(1),
	events: z.array(AuthDiagnosticEvent).min(1).max(64),
});

export const AUTH_DIAGNOSTIC_LIMITS = {
	journalAgeMs: 7 * 24 * 60 * 60 * 1_000,
	journalEvents: 512,
	journalBytes: 256 * 1_024,
	batchEvents: 64,
	batchBytes: 32 * 1_024,
} as const;
