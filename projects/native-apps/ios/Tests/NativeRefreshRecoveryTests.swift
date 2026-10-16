import CryptoKit
import Security
import XCTest
@testable import Readplace

final class NativeRefreshRecoveryTests: XCTestCase {
	override func setUp() { super.setUp(); StubURLProtocol.reset() }

	private func recovery(_ store: TokenStore) -> NativeRefreshRecovery {
		NativeRefreshRecovery(baseURL: AppConfig.serverBaseURL, records: store.authRecords,
			configuration: TestSupport.stubbedConfiguration(), surface: "app", version: "117")
	}

	private func success(operation: String, access: String = "new-access", refresh: String = "new-refresh", expiry: String = "2099-01-01T00:00:00.000Z", recovered: Bool = false) -> StubURLProtocol.Stub {
		.json(200, """
		{"access_token":"\(access)","refresh_token":"\(refresh)","readplace":{"protocol":1,"operation_id":"\(operation)","access_expires_at":"\(expiry)","recovered":\(recovered)}}
		""")
	}

	private func enabled() -> StubURLProtocol.Stub {
		.json(200, "{\"readplace_refresh_protocols_supported\":[1],\"readplace_refresh_enrollment_enabled\":true}")
	}

	func testNonceChallengeSignsExactBodyAndRetriesSamePersistedOperation() async throws {
		let store = TestSupport.loggedInStore(access: "old-access", refresh: "old-refresh")
		var requests = 0
		var operation: String?
		var attempts: [String] = []
		var proofs: [String] = []
		StubURLProtocol.setHandler { request, body in
			if request.url?.path == "/.well-known/oauth-authorization-server" { return self.enabled() }
			requests += 1
			let fields = TestSupport.formFields(body)
			let id = try XCTUnwrap(fields["readplace_refresh_operation_id"])
			if let operation { XCTAssertEqual(id, operation) } else { operation = id }
			XCTAssertEqual(try store.authRecords.read().pending?.id, id, "operation must be durable before any request")
			let proof = try XCTUnwrap(request.value(forHTTPHeaderField: "DPoP"))
			proofs.append(proof)
			attempts.append(try XCTUnwrap(request.value(forHTTPHeaderField: "X-Readplace-Auth-Attempt-Id")))
			let parts = proof.split(separator: ".")
			let claims = try XCTUnwrap(JSONSerialization.jsonObject(with: self.decode(String(parts[1]))) as? [String: Any])
			XCTAssertEqual(claims["readplace_body_sha256"] as? String, self.encode(Data(SHA256.hash(data: body))))
			XCTAssertEqual(claims["readplace_operation_id"] as? String, id)
			let header = try XCTUnwrap(JSONSerialization.jsonObject(with: self.decode(String(parts[0]))) as? [String: Any])
			let jwk = try XCTUnwrap(header["jwk"] as? [String: String])
			let point = Data([4]) + self.decode(try XCTUnwrap(jwk["x"])) + self.decode(try XCTUnwrap(jwk["y"]))
			let key = try P256.Signing.PublicKey(x963Representation: point)
			let signature = try P256.Signing.ECDSASignature(rawRepresentation: self.decode(String(parts[2])))
			XCTAssertTrue(key.isValidSignature(signature, for: Data("\(parts[0]).\(parts[1])".utf8)))
			if requests == 1 { return .init(status: 400, headers: ["DPoP-Nonce": "server-nonce"], body: Data("{\"error\":\"use_dpop_nonce\"}".utf8)) }
			XCTAssertEqual(claims["nonce"] as? String, requests == 2 ? "server-nonce" : "replay-nonce")
			if requests == 2 { return .init(status: 400, headers: ["DPoP-Nonce": "replay-nonce"], body: Data("{\"error\":\"invalid_dpop_proof\",\"readplace_reason\":\"proof_replayed\"}".utf8)) }
			return self.success(operation: id)
		}
		let restored = try await recovery(store).refresh(after: try XCTUnwrap(store.tokens))
		XCTAssertEqual(restored, OAuthTokens(accessToken: "new-access", refreshToken: "new-refresh"))
		XCTAssertEqual(requests, 3)
		XCTAssertEqual(Set(attempts).count, 3)
		XCTAssertEqual(Set(proofs).count, 3)
		XCTAssertEqual(try store.authRecords.read().pending, nil)
		XCTAssertTrue(try store.authRecords.read().bound)
	}

	func testLostResponseKeepsOperationAcrossNewProcessAndNeverFallsBackToLegacy() async throws {
		let defaults = TestSupport.ephemeralDefaults()
		let store = TokenStore(defaults: defaults)
		let old = OAuthTokens(accessToken: "old", refreshToken: "parent")
		store.save(old)
		StubURLProtocol.setHandler { request, _ in
			if request.url?.path == "/.well-known/oauth-authorization-server" { return self.enabled() }
			throw URLError(.networkConnectionLost)
		}
		do { _ = try await recovery(store).refresh(after: old); XCTFail("lost response must remain retryable") } catch {}
		let operation = try XCTUnwrap(store.authRecords.read().pending)
		let restarted = TokenStore(defaults: defaults)
		StubURLProtocol.setHandler { request, body in
			XCTAssertEqual(request.url?.path, "/oauth/token", "a pending operation cannot downgrade through discovery")
			XCTAssertEqual(TestSupport.formFields(body)["readplace_refresh_operation_id"], operation.id)
			return self.success(operation: operation.id, recovered: true)
		}
		let restored = try await recovery(restarted).refresh(after: old)
		XCTAssertEqual(restored?.refreshToken, "new-refresh")
		XCTAssertEqual(store.tokens, restored)
	}

	func testLogoutAndNewLoginFenceAnOldResponse() throws {
		let store = TestSupport.loggedInStore()
		let pending = try store.authRecords.prepare(after: XCTUnwrap(store.tokens))
		store.clear()
		XCTAssertThrowsError(try store.authRecords.commit(OAuthTokens(accessToken: "late", refreshToken: "late"), operation: pending, permit: nil))
		XCTAssertEqual(store.tokens, nil)
		store.save(OAuthTokens(accessToken: "other-user", refreshToken: "other-refresh"))
		XCTAssertThrowsError(try store.authRecords.commit(OAuthTokens(accessToken: "late", refreshToken: "late"), operation: pending, permit: nil))
		XCTAssertEqual(store.tokens?.accessToken, "other-user")
	}

	func testExpiredRecoveredAccessCommitsThenRotatesItsReplacement() async throws {
		let store = TestSupport.loggedInStore()
		var operations: [String] = []
		StubURLProtocol.setHandler { request, body in
			if request.url?.path == "/.well-known/oauth-authorization-server" { return self.enabled() }
			let fields = TestSupport.formFields(body)
			let operation = try XCTUnwrap(fields["readplace_refresh_operation_id"])
			operations.append(operation)
			if operations.count == 1 { return self.success(operation: operation, access: "expired", refresh: "child", expiry: "2000-01-01T00:00:00Z", recovered: true) }
			XCTAssertEqual(fields["refresh_token"], "child")
			XCTAssertEqual(store.tokens?.refreshToken, "child")
			return self.success(operation: operation)
		}
		_ = try await recovery(store).refresh(after: XCTUnwrap(store.tokens))
		XCTAssertEqual(Set(operations).count, 2)
		XCTAssertEqual(store.tokens?.accessToken, "new-access")
	}

	func testUnknownRefusalPreservesCredentialsButExplicitRevocationClearsThem() async throws {
		for reason in ["unknown", "revoked"] {
			let store = TestSupport.loggedInStore()
			let old = try XCTUnwrap(store.tokens)
			StubURLProtocol.setHandler { request, _ in
				if request.url?.path == "/.well-known/oauth-authorization-server" { return self.enabled() }
				return .json(400, "{\"error\":\"invalid_grant\",\"readplace_reason\":\"\(reason)\"}")
			}
			do { _ = try await recovery(store).refresh(after: old); XCTFail("refusal must throw") } catch {}
			XCTAssertEqual(store.tokens, reason == "revoked" ? nil : old)
		}
	}

	func testUnsupportedDiscoveryLeavesLegacyCredentialsUntouched() async throws {
		let store = TestSupport.loggedInStore()
		let old = try XCTUnwrap(store.tokens)
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		let result = try await recovery(store).refresh(after: old)
		XCTAssertEqual(result, nil)
		XCTAssertEqual(store.tokens, old)
		XCTAssertEqual(StubURLProtocol.records.count, 1)
	}

	func testCoordinatorWiresRecoveryAndLogoutRevokesTheHistoricalParent() async throws {
		let store = TestSupport.loggedInStore()
		let original = try XCTUnwrap(store.tokens)
		let pending = try store.authRecords.prepare(after: original)
		let client = recovery(store)
		let oauth = OAuthService(baseURL: AppConfig.serverBaseURL, store: store, nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), recovery: client)
		StubURLProtocol.setHandler { request, _ in
			if request.url?.path == "/oauth/token" { return self.success(operation: pending.id) }
			return .json(200, "{}")
		}
		let refreshed = try await oauth.refresh()
		XCTAssertEqual(refreshed, "new-access")
		await oauth.recordAuthEvent("login_prompt_shown", reason: "no_credentials")
		await oauth.revoke()
		XCTAssertEqual(store.tokens, nil)
		let revocation = try XCTUnwrap(StubURLProtocol.records(path: "/oauth/revoke").first)
		let body = try XCTUnwrap(JSONSerialization.jsonObject(with: revocation.body) as? [String: Any])
		XCTAssertEqual(body["token"] as? String, "new-refresh")
		XCTAssertEqual(body["readplace_refresh_protocol"] as? Int, 1)
		XCTAssertEqual(revocation.request.value(forHTTPHeaderField: "DPoP")?.split(separator: ".").count, 3)
	}

	func testCommitObservesOtherProcessLogoutOrNewerTokens() async throws {
		for replacement in [nil, OAuthTokens(accessToken: "other", refreshToken: "other")] {
			let store = TestSupport.loggedInStore()
			let old = try XCTUnwrap(store.tokens)
			let operation = try store.authRecords.prepare(after: old)
			StubURLProtocol.setHandler { _, _ in
				try store.authRecords.replace(replacement)
				return self.success(operation: operation.id)
			}
			do {
				let answer = try await recovery(store).refresh(after: old)
				XCTAssertEqual(answer, replacement)
			} catch { XCTAssertEqual(replacement, nil) }
			XCTAssertEqual(store.tokens, replacement)
		}
	}

	func testAlreadyChangedSharedStateIsAdoptedWithoutNetwork() async throws {
		let store = TestSupport.loggedInStore()
		let old = try XCTUnwrap(store.tokens)
		let new = OAuthTokens(accessToken: "other", refreshToken: "other")
		store.save(new)
		let answer = try await recovery(store).refresh(after: old)
		XCTAssertEqual(answer, new)
		store.clear()
		do { _ = try await recovery(store).refresh(after: old); XCTFail("logged out") } catch {}
		XCTAssertEqual(StubURLProtocol.records.count, 0)
	}

	func testJournalUploadAfterLogoutKeepsItsOriginalAccountPermit() async throws {
		let store = TestSupport.loggedInStore()
		let client = recovery(store)
		let operation = try store.authRecords.prepare(after: XCTUnwrap(store.tokens))
		await client.record("refresh_prepared", operation: operation.id)
		try store.authRecords.commit(XCTUnwrap(store.tokens), operation: operation, permit: "old-permit")
		let owned = try store.authRecords.prepare(after: XCTUnwrap(store.tokens))
		store.clear()
		await client.record("logout_completed")
		try store.authRecords.update { $0.diagnosticIdentity = UUID().uuidString; $0.diagnosticsPermit = nil }
		await client.record("login_started")
		await client.record("refresh_response_received", operation: owned.id, owner: owned)
		StubURLProtocol.setHandler { request, data in
			XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer old-permit")
			let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
			let events = try XCTUnwrap(body["events"] as? [[String: Any]])
			XCTAssertEqual(events.compactMap { $0["event"] as? String }, ["refresh_prepared", "logout_completed", "refresh_response_received"])
			let ids = events.compactMap { $0["event_id"] as? String }
			return .init(status: 202, body: try JSONSerialization.data(withJSONObject: ["accepted_event_ids": ids]))
		}
		await client.flush()
		XCTAssertEqual(try store.authRecords.read().diagnostics.map(\.event.event), ["login_started"])
	}

	func testJournalBoundsDoNotDiscardPendingRecovery() async throws {
		let store = TestSupport.loggedInStore()
		let operation = try store.authRecords.prepare(after: XCTUnwrap(store.tokens))
		let client = recovery(store)
		for _ in 0..<513 { await client.record("context_started") }
		XCTAssertEqual(try store.authRecords.read().diagnostics.count, 512)
		XCTAssertEqual(try store.authRecords.read().pending, operation)
		XCTAssertEqual(try store.authRecords.read().diagnostics.last?.event.event, "journal_health")
		XCTAssertEqual(try store.authRecords.read().diagnostics.last?.event.dropped_events, 2)
		await client.record("context_started")
		XCTAssertEqual(try store.authRecords.read().diagnostics.filter { $0.event.event == "journal_health" }.count, 1)
		XCTAssertEqual(try store.authRecords.read().diagnostics.last?.event.dropped_events, 3)
	}

	func testLogoutDuringNonceChallengeDoesNotSendAnotherRefresh() async throws {
		let store = TestSupport.loggedInStore()
		let old = try XCTUnwrap(store.tokens)
		let operation = try store.authRecords.prepare(after: old)
		let client = recovery(store)
		StubURLProtocol.setHandler { _, _ in
			store.clear()
			return .init(status: 400, headers: ["DPoP-Nonce": "nonce"], body: Data("{\"error\":\"use_dpop_nonce\"}".utf8))
		}
		do { _ = try await client.refresh(after: old); XCTFail("logout fences retry") } catch {}
		XCTAssertEqual(StubURLProtocol.records.count, 1)
		XCTAssertNil(store.tokens)
		var previous = try store.authRecords.read()
		previous.tokens = old; previous.pending = operation
		StubURLProtocol.setHandler { request, _ in XCTAssertEqual(request.url?.path, "/oauth/revoke"); return .json(200, "{}") }
		try await client.revoke(previous)
	}

	func testAuthenticationTransportRefusesRedirects() {
		let delegate = NativeAuthTransportDelegate()
		let request = URLRequest(url: URL(string: "https://different.example/oauth/token")!)
		let session = URLSession(configuration: .ephemeral)
		let task = session.dataTask(with: request)
		let response = HTTPURLResponse(url: URL(string: AppConfig.serverBaseURL)!, statusCode: 307, httpVersion: nil, headerFields: nil)!
		delegate.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request) { XCTAssertNil($0) }
		session.invalidateAndCancel()
	}

	func testAnOldRequestCannotAdoptAnotherAccountsCredentials() async throws {
		let store = TestSupport.loggedInStore()
		let oauth = OAuthService(baseURL: AppConfig.serverBaseURL, store: store, nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), recovery: recovery(store))
		let original = try await oauth.snapshot()
		try store.authRecords.update {
			$0.accountEpoch = UUID().uuidString
			$0.tokens = OAuthTokens(accessToken: "other-account", refreshToken: "other-account")
		}
		do { _ = try await oauth.refresh(after: original); XCTFail("old request must not cross account boundaries") }
		catch OAuthError.sessionChanged {} catch { XCTFail("unexpected error: \(error)") }
		XCTAssertEqual(StubURLProtocol.records.count, 0)
	}

	func testReplacementStorageFailureRetainsPendingOperationAndReportsStatus() async throws {
		final class Storage: TokenStorage {
			var values: [TokenKey: String] = [:]
			func readValue(for key: TokenKey) -> Result<String?, KeychainError> { .success(values[key]) }
			func setValue(_ value: String, for key: TokenKey) {
				if let data = Data(base64Encoded: value), String(data: data, encoding: .utf8)?.contains("new-access") == true { return }
				values[key] = value
			}
			func removeValue(for key: TokenKey) { values.removeValue(forKey: key) }
		}
		let store = TokenStore(storage: Storage())
		let old = OAuthTokens(accessToken: "old", refreshToken: "old")
		store.save(old)
		let operation = try store.authRecords.prepare(after: old)
		StubURLProtocol.setHandler { _, _ in self.success(operation: operation.id) }
		do { _ = try await recovery(store).refresh(after: old); XCTFail("failed commit must stay retryable") } catch {}
		XCTAssertEqual(try store.authRecords.read().pending, operation)
		XCTAssertEqual(store.tokens, old)
		XCTAssertEqual(try store.authRecords.read().diagnostics.last?.event.reason, "storage_write_failed")
		XCTAssertEqual(try store.authRecords.read().diagnostics.last?.event.storage_status, errSecIO)
		StubURLProtocol.setHandler { _, _ in .json(200, "{\"unexpected\":true}") }
		do { _ = try await recovery(store).refresh(after: old); XCTFail("malformed response must stay retryable") } catch {}
		XCTAssertEqual(try store.authRecords.read().diagnostics.last?.event.reason, "malformed_response")
	}

	func testInitialLoginHasCorrelationHeadersAndUploadsWithItsIssuedPermit() async throws {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let client = recovery(store)
		let oauth = OAuthService(baseURL: AppConfig.serverBaseURL, store: store, nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), recovery: client)
		let uploaded = expectation(description: "initial login diagnostics upload before any refresh")
		StubURLProtocol.setHandler { request, data in
			if request.url?.path == "/oauth/token" {
				XCTAssertNil(request.value(forHTTPHeaderField: "DPoP"))
				for name in ["X-Readplace-Auth-Attempt-Id", "X-Readplace-Auth-Context-Id", "X-Readplace-Installation-Id"] {
					XCTAssertNotNil(UUID(uuidString: try XCTUnwrap(request.value(forHTTPHeaderField: name))))
				}
				XCTAssertEqual(request.value(forHTTPHeaderField: "X-Readplace-Client-Version"), "117")
				return .json(200, "{\"access_token\":\"login-access\",\"refresh_token\":\"login-refresh\",\"diagnostics_permit\":\"login-permit\"}")
			}
			XCTAssertEqual(request.url?.path, "/diagnostics/auth")
			XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer login-permit")
			let batch = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
			let events = try XCTUnwrap(batch["events"] as? [[String: Any]]).compactMap { $0["event"] as? String }
			XCTAssertTrue(events.contains("login_prompt_shown"))
			XCTAssertTrue(events.contains("login_started"))
			XCTAssertTrue(events.contains("login_completed"))
			uploaded.fulfill()
			return .json(503, "{}")
		}
		await oauth.recordAuthEvent("login_prompt_shown", reason: "no_credentials")
		await oauth.recordAuthEvent("login_started")
		_ = try await oauth.exchangeCode("code", verifier: "verifier", redirectURI: "readplace://oauth-callback/ios")
		await fulfillment(of: [uploaded], timeout: 2)
		XCTAssertEqual(try store.authRecords.read().diagnosticsPermit, "login-permit")
	}

	func testFailedDurableLogoutIsReportedAsFailure() async throws {
		final class Storage: TokenStorage {
			var values: [TokenKey: String] = [:]
			func readValue(for key: TokenKey) -> Result<String?, KeychainError> { .success(values[key]) }
			func setValue(_ value: String, for key: TokenKey) {
				if let data = Data(base64Encoded: value), let record = try? JSONDecoder().decode(NativeAuthRecord.self, from: data), record.tokens == nil { return }
				values[key] = value
			}
			func removeValue(for key: TokenKey) { values.removeValue(forKey: key) }
		}
		let store = TokenStore(storage: Storage())
		store.save(OAuthTokens(accessToken: "old", refreshToken: "old"))
		let oauth = OAuthService(baseURL: AppConfig.serverBaseURL, store: store, nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), recovery: recovery(store))
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		await oauth.revoke()
		XCTAssertNotNil(store.tokens)
		let completed = try XCTUnwrap(store.authRecords.read().diagnostics.last?.event)
		XCTAssertEqual(completed.event, "logout_completed")
		XCTAssertEqual(completed.outcome, "failure")
		XCTAssertEqual(completed.reason, "storage_write_failed")
	}

	private func encode(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
	private func decode(_ value: String) -> Data {
		let base = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
		return Data(base64Encoded: base + String(repeating: "=", count: (4 - base.count % 4) % 4))!
	}
}
