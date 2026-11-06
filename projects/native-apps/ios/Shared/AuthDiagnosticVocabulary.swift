enum AuthEvent: String, Codable, CaseIterable {
	case contextStarted = "context_started"
	case loginPromptShown = "login_prompt_shown"
	case loginStarted = "login_started"
	case loginCallbackReceived = "login_callback_received"
	case loginCompleted = "login_completed"
	case loginCancelled = "login_cancelled"
	case loginFailed = "login_failed"
	case logoutStarted = "logout_started"
	case logoutCompleted = "logout_completed"
	case accountSwitched = "account_switched"
	case refreshPrepared = "refresh_prepared"
	case refreshRequestStarted = "refresh_request_started"
	case refreshResponseReceived = "refresh_response_received"
	case refreshParsed = "refresh_parsed"
	case storageStarted = "storage_started"
	case storageCompleted = "storage_completed"
	case storageRead = "storage_read"
	case storageFailed = "storage_failed"
	case refreshCompleted = "refresh_completed"
	case refreshFailed = "refresh_failed"
	case refreshRecovered = "refresh_recovered"
	case credentialsCleared = "credentials_cleared"
	case sessionBridgeCompleted = "session_bridge_completed"
	case journalHealth = "journal_health"
}

enum AuthOutcome: String, Codable, CaseIterable {
	case success
	case failure
	case cancelled
	case retry
	case preserved
	case recovered
	case joined
	case skipped
}

enum AuthReason: String, Codable, CaseIterable {
	case userRequested = "user_requested"
	case noCredentials = "no_credentials"
	case expired
	case revoked
	case superseded
	case nonceRequired = "nonce_required"
	case nonceExpired = "nonce_expired"
	case proofReplayed = "proof_replayed"
	case proofInvalid = "proof_invalid"
	case proofRequired = "proof_required"
	case keyMismatch = "key_mismatch"
	case operationMismatch = "operation_mismatch"
	case invalidScope = "invalid_scope"
	case enrollmentDisabled = "enrollment_disabled"
	case storageUnavailable = "storage_unavailable"
	case networkError = "network_error"
	case timeout
	case httpError = "http_error"
	case malformedResponse = "malformed_response"
	case storageMissing = "storage_missing"
	case storageUnreadable = "storage_unreadable"
	case storageWriteFailed = "storage_write_failed"
	case storageDeleteFailed = "storage_delete_failed"
	case storagePartial = "storage_partial"
	case storageMismatch = "storage_mismatch"
	case newerGeneration = "newer_generation"
	case callbackInvalid = "callback_invalid"
	case providerRejected = "provider_rejected"
	case userCancelled = "user_cancelled"
	case cookieAbsent = "cookie_absent"
	case rowMissing = "row_missing"
	case lookupError = "lookup_error"
	case webLogout = "web_logout"
	case nativeLogout = "native_logout"
	case oauthAccountSwitch = "oauth_account_switch"
	case passwordReset = "password_reset"
	case accountDeleted = "account_deleted"
	case slidingVisit = "sliding_visit"
	case oauthBridge = "oauth_bridge"
	case browserHandoff = "browser_handoff"
	case login
	case legacyMigration = "legacy_migration"
	case refreshRejected = "refresh_rejected"
	case journalOverflow = "journal_overflow"
	case journalUnavailable = "journal_unavailable"
	case unknown
}

enum AuthSurface: String, Codable, CaseIterable {
	case website
	case background
	case popup
	case app
	case share
	case webview
}
