import XCTest
@testable import Readplace

/// End-to-end coverage of the login journey through the real production types,
/// with the network faked by `StubURLProtocol`. Login opens `/oauth/authorize`
/// in the external browser (carrying `screen_hint=login`) and returns through the
/// native `readplace://oauth-callback` deep link; after that OS-owned redirect,
/// `completeSignIn` exchanges the code and the session flips to logged-in, then a
/// reading-list load renders the queue with the bearer token preserved across the
/// entry-point 303.
@MainActor
final class LoginFlowTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeService(store: TokenStore) -> OAuthService {
		OAuthService(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
	}

	func testLoginAuthorizationRequestUsesNativeRedirectAndLoginHint() {
		let request = makeService(store: TestSupport.loggedInStore()).makeNativeLoginAuthorizationRequest()

		let components = URLComponents(url: request.url, resolvingAgainstBaseURL: false)!
		XCTAssertEqual(components.host, "readplace.com")
		XCTAssertEqual(components.path, "/oauth/authorize")
		let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
		XCTAssertEqual(items["client_id"], "hutch-chrome-extension")
		XCTAssertEqual(items["redirect_uri"], AppConfig.nativeCallbackURL)
		XCTAssertEqual(items["response_type"], "code")
		XCTAssertEqual(items["code_challenge_method"], "S256")
		XCTAssertEqual(items["screen_hint"], "login")
		XCTAssertEqual(items["code_challenge"], PKCE.challenge(for: request.codeVerifier))
		XCTAssertFalse((items["state"] ?? "").isEmpty)
		XCTAssertGreaterThanOrEqual(request.codeVerifier.count, 43)
		XCTAssertEqual(request.redirectURI, AppConfig.nativeCallbackURL)
	}

	func testCompleteSignInExchangesCodeAndFlipsSessionToLoggedIn() async throws {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
		XCTAssertFalse(session.isLoggedIn)

		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.url?.path, "/oauth/token")
			return .json(200, Fixtures.tokenResponse(access: "fresh-access", refresh: "fresh-refresh"))
		}

		var exchangeStarts = 0
		let result = await session.completeSignIn(
			callbackURL: URL(string: "\(AppConfig.nativeCallbackURL)?code=abc&state=S")!,
			verifier: "v",
			expectedState: "S",
			redirectURI: AppConfig.nativeCallbackURL,
			onExchangeStarted: { exchangeStarts += 1 }
		)

		guard case .success = result else { return XCTFail("Expected .success, got \(result)") }
		XCTAssertEqual(exchangeStarts, 1, "the Signing-in overlay is raised once, when the exchange begins")
		XCTAssertTrue(session.isLoggedIn, "RootView keys off isLoggedIn to show the reading list")
		XCTAssertEqual(store.tokens?.accessToken, "fresh-access", "token must be persisted for the share extension")
		XCTAssertEqual(store.tokens?.refreshToken, "fresh-refresh")

		let body = TestSupport.formFields(try XCTUnwrap(StubURLProtocol.records(path: "/oauth/token").first).body)
		XCTAssertEqual(body["grant_type"], "authorization_code")
		XCTAssertEqual(body["code"], "abc")
		XCTAssertEqual(body["code_verifier"], "v")
		XCTAssertEqual(body["client_id"], "hutch-chrome-extension")
		XCTAssertEqual(body["redirect_uri"], AppConfig.nativeCallbackURL)
	}

	func testRejectedCallbackNeitherRaisesOverlayNorExchanges() async throws {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())

		var exchangeStarts = 0
		let result = await session.completeSignIn(
			callbackURL: URL(string: "\(AppConfig.nativeCallbackURL)?code=abc&state=WRONG")!,
			verifier: "v",
			expectedState: "S",
			redirectURI: AppConfig.nativeCallbackURL,
			onExchangeStarted: { exchangeStarts += 1 }
		)

		guard case .failure(let error) = result else { return XCTFail("Expected .failure for a state mismatch, got \(result)") }
		XCTAssertEqual((error as? AuthFlowError)?.errorDescription, AuthFlowError.stateMismatch.errorDescription)
		XCTAssertEqual(exchangeStarts, 0, "a rejected callback must not raise the Signing-in overlay")
		XCTAssertFalse(session.isLoggedIn)
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "a rejected callback must not exchange the code")
	}

	func testLoggedInThenLoadQueueRendersArticles() async throws {
		let store = TestSupport.loggedInStore(access: "access-1")
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
		XCTAssertTrue(session.isLoggedIn)

		StubURLProtocol.setHandler { request, _ in
			switch request.url?.path {
			case "/":
				return .redirect(to: "/queue")
			case "/queue":
				return .json(200, Fixtures.collection(
					entitiesJSON: [Fixtures.article(id: "a1"), Fixtures.article(id: "a2")], total: 2))
			default:
				return .json(404, "{}")
			}
		}

		let viewModel = ReadingListViewModel(api: session.makeAPI(), onSessionExpired: {})
		await viewModel.loadIfNeeded()

		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"])
		XCTAssertNil(viewModel.errorText)
		XCTAssertFalse(viewModel.isLoading)

		// Proves the bearer token + Siren Accept survived the entry-point 303.
		let queueRequest = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first?.request)
		XCTAssertEqual(queueRequest.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
		XCTAssertEqual(queueRequest.value(forHTTPHeaderField: "Accept"), "application/vnd.siren+json")
	}
}
