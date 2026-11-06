package com.readplace.android.core

import kotlinx.serialization.descriptors.SerialDescriptor
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthDiagnosticVocabularyTest {
	private fun wireNames(descriptor: SerialDescriptor) =
		(0 until descriptor.elementsCount).map { descriptor.getElementName(it) }

	@Test fun `event constants carry the server vocabulary in server order`() {
		assertEquals(
			listOf(
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
			),
			wireNames(AuthEvent.serializer().descriptor),
		)
	}

	@Test fun `outcome constants carry the server vocabulary in server order`() {
		assertEquals(
			listOf(
				"success",
				"failure",
				"cancelled",
				"retry",
				"preserved",
				"recovered",
				"joined",
				"skipped",
			),
			wireNames(AuthOutcome.serializer().descriptor),
		)
	}

	@Test fun `reason constants carry the server vocabulary in server order`() {
		assertEquals(
			listOf(
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
			),
			wireNames(AuthReason.serializer().descriptor),
		)
	}

	@Test fun `surface constants carry the server vocabulary in server order`() {
		assertEquals(
			listOf(
				"website",
				"background",
				"popup",
				"app",
				"share",
				"webview",
			),
			wireNames(AuthSurface.serializer().descriptor),
		)
	}
}
