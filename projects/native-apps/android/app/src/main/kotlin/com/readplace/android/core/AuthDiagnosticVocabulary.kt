package com.readplace.android.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class AuthEvent {
	@SerialName("context_started") CONTEXT_STARTED,
	@SerialName("login_prompt_shown") LOGIN_PROMPT_SHOWN,
	@SerialName("login_started") LOGIN_STARTED,
	@SerialName("login_callback_received") LOGIN_CALLBACK_RECEIVED,
	@SerialName("login_completed") LOGIN_COMPLETED,
	@SerialName("login_cancelled") LOGIN_CANCELLED,
	@SerialName("login_failed") LOGIN_FAILED,
	@SerialName("logout_started") LOGOUT_STARTED,
	@SerialName("logout_completed") LOGOUT_COMPLETED,
	@SerialName("account_switched") ACCOUNT_SWITCHED,
	@SerialName("refresh_prepared") REFRESH_PREPARED,
	@SerialName("refresh_request_started") REFRESH_REQUEST_STARTED,
	@SerialName("refresh_response_received") REFRESH_RESPONSE_RECEIVED,
	@SerialName("refresh_parsed") REFRESH_PARSED,
	@SerialName("storage_started") STORAGE_STARTED,
	@SerialName("storage_completed") STORAGE_COMPLETED,
	@SerialName("storage_read") STORAGE_READ,
	@SerialName("storage_failed") STORAGE_FAILED,
	@SerialName("refresh_completed") REFRESH_COMPLETED,
	@SerialName("refresh_failed") REFRESH_FAILED,
	@SerialName("refresh_recovered") REFRESH_RECOVERED,
	@SerialName("credentials_cleared") CREDENTIALS_CLEARED,
	@SerialName("session_bridge_completed") SESSION_BRIDGE_COMPLETED,
	@SerialName("journal_health") JOURNAL_HEALTH,
}

@Serializable
enum class AuthOutcome {
	@SerialName("success") SUCCESS,
	@SerialName("failure") FAILURE,
	@SerialName("cancelled") CANCELLED,
	@SerialName("retry") RETRY,
	@SerialName("preserved") PRESERVED,
	@SerialName("recovered") RECOVERED,
	@SerialName("joined") JOINED,
	@SerialName("skipped") SKIPPED,
}

@Serializable
enum class AuthReason {
	@SerialName("user_requested") USER_REQUESTED,
	@SerialName("no_credentials") NO_CREDENTIALS,
	@SerialName("expired") EXPIRED,
	@SerialName("revoked") REVOKED,
	@SerialName("superseded") SUPERSEDED,
	@SerialName("nonce_required") NONCE_REQUIRED,
	@SerialName("nonce_expired") NONCE_EXPIRED,
	@SerialName("proof_replayed") PROOF_REPLAYED,
	@SerialName("proof_invalid") PROOF_INVALID,
	@SerialName("proof_required") PROOF_REQUIRED,
	@SerialName("key_mismatch") KEY_MISMATCH,
	@SerialName("operation_mismatch") OPERATION_MISMATCH,
	@SerialName("invalid_scope") INVALID_SCOPE,
	@SerialName("enrollment_disabled") ENROLLMENT_DISABLED,
	@SerialName("storage_unavailable") STORAGE_UNAVAILABLE,
	@SerialName("network_error") NETWORK_ERROR,
	@SerialName("timeout") TIMEOUT,
	@SerialName("http_error") HTTP_ERROR,
	@SerialName("malformed_response") MALFORMED_RESPONSE,
	@SerialName("storage_missing") STORAGE_MISSING,
	@SerialName("storage_unreadable") STORAGE_UNREADABLE,
	@SerialName("storage_write_failed") STORAGE_WRITE_FAILED,
	@SerialName("storage_delete_failed") STORAGE_DELETE_FAILED,
	@SerialName("storage_partial") STORAGE_PARTIAL,
	@SerialName("storage_mismatch") STORAGE_MISMATCH,
	@SerialName("newer_generation") NEWER_GENERATION,
	@SerialName("callback_invalid") CALLBACK_INVALID,
	@SerialName("provider_rejected") PROVIDER_REJECTED,
	@SerialName("user_cancelled") USER_CANCELLED,
	@SerialName("cookie_absent") COOKIE_ABSENT,
	@SerialName("row_missing") ROW_MISSING,
	@SerialName("lookup_error") LOOKUP_ERROR,
	@SerialName("web_logout") WEB_LOGOUT,
	@SerialName("native_logout") NATIVE_LOGOUT,
	@SerialName("oauth_account_switch") OAUTH_ACCOUNT_SWITCH,
	@SerialName("password_reset") PASSWORD_RESET,
	@SerialName("account_deleted") ACCOUNT_DELETED,
	@SerialName("sliding_visit") SLIDING_VISIT,
	@SerialName("oauth_bridge") OAUTH_BRIDGE,
	@SerialName("browser_handoff") BROWSER_HANDOFF,
	@SerialName("login") LOGIN,
	@SerialName("legacy_migration") LEGACY_MIGRATION,
	@SerialName("refresh_rejected") REFRESH_REJECTED,
	@SerialName("journal_overflow") JOURNAL_OVERFLOW,
	@SerialName("journal_unavailable") JOURNAL_UNAVAILABLE,
	@SerialName("unknown") UNKNOWN,
}

@Serializable
enum class AuthSurface {
	@SerialName("website") WEBSITE,
	@SerialName("background") BACKGROUND,
	@SerialName("popup") POPUP,
	@SerialName("app") APP,
	@SerialName("share") SHARE,
	@SerialName("webview") WEBVIEW,
}
