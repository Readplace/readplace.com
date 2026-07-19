import XCTest
@testable import Readplace

final class OAuthServiceTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeService(store: TokenStore) -> OAuthService {
		OAuthService(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
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

	func testRefreshFailureThrows() async {
		let store = TestSupport.loggedInStore()
		StubURLProtocol.setHandler { _, _ in .json(400, "{}") }
		do {
			_ = try await makeService(store: store).refresh()
			XCTFail("Expected refresh to throw")
		} catch {
			// expected
		}
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
}
