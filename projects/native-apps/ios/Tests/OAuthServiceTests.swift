import XCTest
@testable import Readplace

final class OAuthServiceTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeService(store: TokenStore) -> OAuthService {
		OAuthService(
			baseURL: AppConfig.serverBaseURL,
			store: store,
			nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration()
		)
	}

	func testExchangeCodeStoresTokensAndSendsCorrectBody() async throws {
		let store = TestSupport.loggedInStore(access: "old", refresh: "old-r")
		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.url?.path, "/oauth/token")
			XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
			return .json(200, Fixtures.tokenResponse(access: "new-access", refresh: "new-refresh"))
		}

		let tokens = try await makeService(store: store).exchangeCode("AUTH_CODE", verifier: "VERIFIER", redirectURI: AppConfig.nativeCallbackURL)

		XCTAssertEqual(tokens.accessToken, "new-access")
		XCTAssertEqual(tokens.refreshToken, "new-refresh")
		XCTAssertEqual(store.tokens?.accessToken, "new-access")
		XCTAssertEqual(store.tokens?.refreshToken, "new-refresh")

		let body = TestSupport.formFields(StubURLProtocol.records(path: "/oauth/token").first!.body)
		XCTAssertEqual(body["grant_type"], "authorization_code")
		XCTAssertEqual(body["code"], "AUTH_CODE")
		XCTAssertEqual(body["code_verifier"], "VERIFIER")
		XCTAssertEqual(body["client_id"], "ios-app")
		XCTAssertEqual(body["redirect_uri"], AppConfig.nativeCallbackURL)
	}

	func testExchangeCodeFailureThrows() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(400, "{\"error\":\"invalid_grant\"}") }
		do {
			_ = try await makeService(store: store).exchangeCode("BAD", verifier: "V", redirectURI: AppConfig.nativeCallbackURL)
			XCTFail("Expected exchange to throw")
		} catch {
			// expected
		}
	}

	func testRefreshUpdatesAccessAndKeepsExistingRefreshWhenOmitted() async throws {
		let store = TestSupport.loggedInStore(access: "a1", refresh: "r1")
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.tokenResponse(access: "a2", refresh: nil)) }

		let newAccess = try await makeService(store: store).refresh()

		XCTAssertEqual(newAccess, "a2")
		XCTAssertEqual(store.tokens?.accessToken, "a2")
		XCTAssertEqual(store.tokens?.refreshToken, "r1", "refresh token must be preserved when the server omits it")
	}

	func testRefreshUpdatesBothTokensWhenProvided() async throws {
		let store = TestSupport.loggedInStore(access: "a1", refresh: "r1")
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.tokenResponse(access: "a3", refresh: "r3")) }

		_ = try await makeService(store: store).refresh()

		XCTAssertEqual(store.tokens?.accessToken, "a3")
		XCTAssertEqual(store.tokens?.refreshToken, "r3")
		let body = TestSupport.formFields(StubURLProtocol.records(path: "/oauth/token").first!.body)
		XCTAssertEqual(body["grant_type"], "refresh_token")
		XCTAssertEqual(body["refresh_token"], "r1")
	}

	func testRefreshDiscardsARejectedRefreshToken() async {
		let store = TestSupport.loggedInStore(access: "a1", refresh: "r1")
		StubURLProtocol.setHandler { _, _ in .json(400, "{\"error\":\"invalid_grant\"}") }
		do {
			_ = try await makeService(store: store).refresh()
			XCTFail("expected rejection")
		} catch {
			XCTAssertEqual((error as? OAuthError)?.errorDescription, OAuthError.noRefreshToken.errorDescription)
		}
		XCTAssertNil(store.tokens)
	}

	func testRefreshKeepsTheStoredTokensWhenTheServerIsUnavailable() async {
		let store = TestSupport.loggedInStore(access: "a1", refresh: "r1")
		StubURLProtocol.setHandler { _, _ in .json(503, "{}") }
		do {
			_ = try await makeService(store: store).refresh()
			XCTFail("expected .refreshFailed")
		} catch {
			XCTAssertEqual((error as? OAuthError)?.errorDescription, OAuthError.refreshFailed.errorDescription)
		}
		XCTAssertEqual(store.tokens?.refreshToken, "r1", "only an outright rejection discards the token")
	}

	func testRefreshLeavesATokenAnOverlappingRefreshAlreadyStored() async throws {
		let store = TestSupport.loggedInStore(access: "a1", refresh: "r1")
		StubURLProtocol.setHandler { _, _ in
			store.save(OAuthTokens(accessToken: "a2", refreshToken: "r2"))
			return .json(400, "{\"error\":\"invalid_grant\"}")
		}
		let access = try await makeService(store: store).refresh()
		XCTAssertEqual(access, "a2")
		XCTAssertEqual(store.tokens?.refreshToken, "r2")
	}

	func testTransientAndMalformedRefusalsPreserveCredentials() async {
		for status in [400, 429, 500, 503] {
			let store = TestSupport.loggedInStore()
			let original = store.tokens
			StubURLProtocol.setHandler { _, _ in .json(status, "{}") }
			do { _ = try await makeService(store: store).refresh(); XCTFail("expected failure") }
			catch { XCTAssertEqual(store.tokens, original) }
		}
	}

	func testDelayed401ReusesRefreshedCredentials() async throws {
		let store = TestSupport.loggedInStore()
		let oauth = makeService(store: store)
		let original = try await oauth.snapshot()
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.tokenResponse(access: "new", refresh: "new-r")) }
		_ = try await oauth.refresh(after: original)
		let delayed = try await oauth.refresh(after: original)
		XCTAssertEqual(delayed.snapshot.tokens.accessToken, "new")
		XCTAssertEqual(StubURLProtocol.records(path: "/oauth/token").count, 1)
	}

	func testDelayedSessionClearPreservesReplacementCredentials() async {
		let store = TestSupport.loggedInStore()
		let oauth = makeService(store: store)
		let rejected = store.tokens
		let replacement = OAuthTokens(accessToken: "replacement", refreshToken: "replacement-r")
		store.save(replacement)
		await oauth.clear(ifUnchanged: rejected)
		XCTAssertEqual(store.tokens, replacement)
		await oauth.clear(ifUnchanged: replacement)
		XCTAssertNil(store.tokens)
	}

	func testEmptySuccessfulRefreshCredentialsPreserveSession() async {
		for tokens in [Fixtures.tokenResponse(access: "", refresh: "r"), Fixtures.tokenResponse(access: "a", refresh: "")] {
			let store = TestSupport.loggedInStore()
			let original = store.tokens
			StubURLProtocol.setHandler { _, _ in .json(200, tokens) }
			do { _ = try await makeService(store: store).refresh(); XCTFail("expected malformed response") }
			catch { XCTAssertEqual(store.tokens, original) }
		}
	}

	func testLogoutDuringRefreshCannotRestoreTokens() async throws {
		let store = TestSupport.loggedInStore()
		let oauth = makeService(store: store)
		let started = expectation(description: "refresh started")
		let gate = DispatchSemaphore(value: 0)
		StubURLProtocol.setHandler { _, _ in
			started.fulfill()
			return .json(200, Fixtures.tokenResponse(access: "late", refresh: "late-r")).held(until: gate)
		}
		let refresh = Task { try await oauth.refresh() }
		await fulfillment(of: [started], timeout: 2)
		await oauth.clear()
		gate.signal()
		do { _ = try await refresh.value; XCTFail("late response must fail") }
		catch { XCTAssertNil(store.tokens) }
	}

	func testConcurrentCallersShareRefreshDespiteCallerCancellation() async throws {
		let store = TestSupport.loggedInStore()
		let oauth = makeService(store: store)
		let snapshot = try await oauth.snapshot()
		let started = expectation(description: "refresh started")
		let gate = DispatchSemaphore(value: 0)
		StubURLProtocol.setHandler { _, _ in
			started.fulfill()
			return .json(200, Fixtures.tokenResponse(access: "new", refresh: "new-r")).held(until: gate)
		}
		let first = Task { try await oauth.refresh(after: snapshot) }
		await fulfillment(of: [started], timeout: 2)
		first.cancel()
		let second = Task { try await oauth.refresh(after: snapshot) }
		gate.signal()
		let result = try await second.value
		_ = try await first.value
		XCTAssertEqual(result.snapshot.tokens.accessToken, "new")
		XCTAssertEqual(StubURLProtocol.records(path: "/oauth/token").count, 1)
	}

	func testRevokeClearsTokens() async throws {
		let store = TestSupport.loggedInStore(access: "a1", refresh: "r1")
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }

		await makeService(store: store).revoke()

		XCTAssertNil(store.tokens)
		let record = try XCTUnwrap(StubURLProtocol.records(path: "/oauth/revoke").first)
		let json = TestSupport.jsonObject(record.body)
		XCTAssertEqual(json["token"] as? String, "r1")
	}

	func testExchangeCodeWithAMalformedBodyThrowsMalformedResponse() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(200, "not json at all") }
		do {
			try await makeService(store: store).exchangeCode("c", verifier: "v", redirectURI: AppConfig.nativeCallbackURL)
			XCTFail("expected .malformedResponse")
		} catch {
			XCTAssertEqual((error as? OAuthError)?.errorDescription, OAuthError.malformedResponse.errorDescription)
		}
	}

	func testExchangeCodeWithoutARefreshTokenThrowsMalformedResponse() async {
		let store = TestSupport.loggedInStore()
		// A 200 that carries an access token but no refresh_token, and no fallback
		// (exchange has none), is malformed — the session can't be refreshed later.
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.tokenResponse(access: "a", refresh: nil)) }
		do {
			try await makeService(store: store).exchangeCode("c", verifier: "v", redirectURI: AppConfig.nativeCallbackURL)
			XCTFail("expected .malformedResponse")
		} catch {
			XCTAssertEqual((error as? OAuthError)?.errorDescription, OAuthError.malformedResponse.errorDescription)
		}
	}

	func testRefreshWithoutAStoredRefreshTokenThrowsAndMakesNoRequest() async {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		do {
			_ = try await makeService(store: store).refresh()
			XCTFail("expected .noRefreshToken")
		} catch {
			XCTAssertEqual((error as? OAuthError)?.errorDescription, OAuthError.noRefreshToken.errorDescription)
		}
		XCTAssertTrue(StubURLProtocol.records(path: "/oauth/token").isEmpty, "no token request without a refresh token")
	}

	func testRevokeWithoutAStoredTokenSkipsTheNetworkButStillClears() async {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		await makeService(store: store).revoke()
		XCTAssertNil(store.tokens)
		XCTAssertTrue(StubURLProtocol.records(path: "/oauth/revoke").isEmpty, "nothing to revoke without a token")
	}

	func testExchangeCodeNamesTheBuildInItsUserAgent() async throws {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.tokenResponse(access: "a", refresh: "r")) }

		try await makeService(store: store).exchangeCode("c", verifier: "v", redirectURI: AppConfig.nativeCallbackURL)

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/oauth/token").first)
		XCTAssertEqual(
			record.request.value(forHTTPHeaderField: "User-Agent"), TestSupport.nativeUserAgent,
			"the access log must name the build that signed in — CFNetwork's stock string cannot tell a dev device from a reader"
		)
	}

	func testRefreshNamesTheBuildInItsUserAgent() async throws {
		let store = TestSupport.loggedInStore(access: "a1", refresh: "r1")
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.tokenResponse(access: "a2", refresh: nil)) }

		_ = try await makeService(store: store).refresh()

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/oauth/token").first)
		XCTAssertEqual(
			record.request.value(forHTTPHeaderField: "User-Agent"), TestSupport.nativeUserAgent,
			"a refused refresh is only diagnosable when the log names the build whose session was refused"
		)
	}

	func testRevokeNamesTheBuildInItsUserAgent() async throws {
		let store = TestSupport.loggedInStore(access: "a1", refresh: "r1")
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }

		await makeService(store: store).revoke()

		let record = try XCTUnwrap(StubURLProtocol.records(path: "/oauth/revoke").first)
		XCTAssertEqual(
			record.request.value(forHTTPHeaderField: "User-Agent"), TestSupport.nativeUserAgent,
			"revoke builds its own request instead of the token one, so identity added only to the token request leaves sign-out anonymous"
		)
	}
}

extension OAuthServiceTests {
	func testRecoveryCarriesTheExactRefusalProofAfterAdoptingSharedCredentials() async throws {
		let store = TestSupport.loggedInStore(access: "old", refresh: "old-r")
		let oauth = makeService(store: store)
		let snapshot = try await oauth.snapshot()
		StubURLProtocol.setHandler { _, _ in
			store.save(OAuthTokens(accessToken: "winner", refreshToken: "winner-r"))
			return StubURLProtocol.Stub(status: 400, headers: ["X-Readplace-Refresh-Attempt": "signed-proof"], body: Data("{\"error\":\"invalid_grant\"}".utf8))
		}
		let recovered = try await oauth.refresh(after: snapshot)
		XCTAssertEqual(recovered.snapshot.tokens.accessToken, "winner")
		XCTAssertEqual(recovered.recoveryProof, "signed-proof")
	}

	func testNetworkRefreshFailurePreservesCredentials() async {
		let store = TestSupport.loggedInStore()
		let tokens = store.tokens
		StubURLProtocol.setHandler { _, _ in throw URLError(.notConnectedToInternet) }
		do { _ = try await makeService(store: store).refresh(); XCTFail("expected network failure") }
		catch { XCTAssertEqual(store.tokens, tokens) }
	}

	func testRecoveryProofCannotFollowACrossOriginRedirect() {
		var original = URLRequest(url: URL(string: "https://readplace.com/")!)
		original.setValue("proof", forHTTPHeaderField: "X-Readplace-Refresh-Recovery")
		let own = RedirectHeaders.preserving(from: original, onto: URLRequest(url: URL(string: "https://readplace.com/queue")!))
		XCTAssertEqual(own.value(forHTTPHeaderField: "X-Readplace-Refresh-Recovery"), "proof")
		for target in ["https://other.test/", "http://readplace.com/", "https://readplace.com:8443/"] {
			let external = RedirectHeaders.preserving(from: original, onto: URLRequest(url: URL(string: target)!))
			XCTAssertNil(external.value(forHTTPHeaderField: "X-Readplace-Refresh-Recovery"))
		}
	}
}
