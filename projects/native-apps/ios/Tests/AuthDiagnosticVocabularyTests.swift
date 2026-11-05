import XCTest
@testable import Readplace

final class AuthDiagnosticVocabularyTests: XCTestCase {
	func testEventEncodesToTheServerWireFormat() throws {
		let event = NativeAuthEvent(event_id: "event-1", event: .loginStarted, occurred_at: "2026-10-16T00:00:00Z", surface: .app, context_id: "context-1", client_version: "117", outcome: .success, reason: .noCredentials)
		let encoder = JSONEncoder()
		encoder.outputFormatting = .sortedKeys

		let json = String(decoding: try encoder.encode(event), as: UTF8.self)

		XCTAssertEqual(json, #"{"client":"ios","client_version":"117","context_id":"context-1","event":"login_started","event_id":"event-1","occurred_at":"2026-10-16T00:00:00Z","outcome":"success","reason":"no_credentials","surface":"app"}"#)
	}

	func testAuthEventMatchesTheServerVocabulary() {
		XCTAssertEqual(AuthEvent.allCases.map(\.rawValue), [
			"context_started",
			"login_prompt_shown",
			"login_started",
			"login_callback_received",
			"login_completed",
			"login_cancelled",
			"login_failed",
			"logout_started",
			"logout_completed",
			"account_switched",
			"refresh_prepared",
			"refresh_request_started",
			"refresh_response_received",
			"refresh_parsed",
			"storage_started",
			"storage_completed",
			"storage_read",
			"storage_failed",
			"refresh_completed",
			"refresh_failed",
			"refresh_recovered",
			"credentials_cleared",
			"session_bridge_completed",
			"journal_health",
		])
	}

	func testAuthOutcomeMatchesTheServerVocabulary() {
		XCTAssertEqual(AuthOutcome.allCases.map(\.rawValue), [
			"success",
			"failure",
			"cancelled",
			"retry",
			"preserved",
			"recovered",
			"joined",
			"skipped",
		])
	}

	func testAuthReasonMatchesTheServerVocabulary() {
		XCTAssertEqual(AuthReason.allCases.map(\.rawValue), [
			"user_requested",
			"no_credentials",
			"expired",
			"revoked",
			"superseded",
			"nonce_required",
			"nonce_expired",
			"proof_replayed",
			"proof_invalid",
			"proof_required",
			"key_mismatch",
			"operation_mismatch",
			"invalid_scope",
			"enrollment_disabled",
			"storage_unavailable",
			"network_error",
			"timeout",
			"http_error",
			"malformed_response",
			"storage_missing",
			"storage_unreadable",
			"storage_write_failed",
			"storage_delete_failed",
			"storage_partial",
			"storage_mismatch",
			"newer_generation",
			"callback_invalid",
			"provider_rejected",
			"user_cancelled",
			"cookie_absent",
			"row_missing",
			"lookup_error",
			"web_logout",
			"native_logout",
			"oauth_account_switch",
			"password_reset",
			"account_deleted",
			"sliding_visit",
			"oauth_bridge",
			"browser_handoff",
			"login",
			"legacy_migration",
			"refresh_rejected",
			"journal_overflow",
			"journal_unavailable",
			"unknown",
		])
	}

	func testAuthSurfaceMatchesTheServerVocabulary() {
		XCTAssertEqual(AuthSurface.allCases.map(\.rawValue), [
			"website",
			"background",
			"popup",
			"app",
			"share",
			"webview",
		])
	}
}
