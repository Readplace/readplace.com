import XCTest
@testable import Readplace

/// End-to-end coverage of the login journey through the real production types,
/// with the network faked by `StubURLProtocol`. Login presents `/oauth/authorize`
/// in the in-app auth session (carrying `screen_hint=login`), which captures the
/// `readplace://oauth-callback` redirect and hands it to `completeSignIn`, which
/// exchanges the code and flips the session to logged-in; then a reading-list
/// load renders the queue with the bearer token preserved across the entry-point
/// 303.
@MainActor
final class LoginFlowTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeService(store: TokenStore) -> OAuthService {
		OAuthService(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
	}

	func testTheAppsDefaultSessionConfigurationCachesNoResponses() {
		let configuration = AppSession.uncachedEphemeralConfiguration()

		XCTAssertNil(
			configuration.urlCache,
			"the app's list views must always revalidate; only the share extension opts into the discovery cache"
		)
	}

	func testLoginAuthorizationRequestUsesNativeRedirectAndLoginHint() {
		let request = makeService(store: TestSupport.loggedInStore()).makeNativeLoginAuthorizationRequest()

		let components = URLComponents(url: request.url, resolvingAgainstBaseURL: false)!
		XCTAssertEqual(components.host, URL(string: AppConfig.serverBaseURL)?.host)
		XCTAssertEqual(components.path, "/oauth/authorize")
		let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
		XCTAssertEqual(items["client_id"], "ios-app")
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

		let result = await session.completeSignIn(
			callbackURL: URL(string: "\(AppConfig.nativeCallbackURL)?code=abc&state=S")!,
			verifier: "v",
			expectedState: "S",
			redirectURI: AppConfig.nativeCallbackURL
		)

		guard case .success = result else { return XCTFail("Expected .success, got \(result)") }
		XCTAssertTrue(session.isLoggedIn, "RootView keys off isLoggedIn to show the reading list")
		XCTAssertEqual(store.tokens?.accessToken, "fresh-access", "token must be persisted for the share extension")
		XCTAssertEqual(store.tokens?.refreshToken, "fresh-refresh")

		let body = TestSupport.formFields(try XCTUnwrap(StubURLProtocol.records(path: "/oauth/token").first).body)
		XCTAssertEqual(body["grant_type"], "authorization_code")
		XCTAssertEqual(body["code"], "abc")
		XCTAssertEqual(body["code_verifier"], "v")
		XCTAssertEqual(body["client_id"], "ios-app")
		XCTAssertEqual(body["redirect_uri"], AppConfig.nativeCallbackURL)
	}

	func testRejectedCallbackDoesNotExchange() async throws {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())

		let result = await session.completeSignIn(
			callbackURL: URL(string: "\(AppConfig.nativeCallbackURL)?code=abc&state=WRONG")!,
			verifier: "v",
			expectedState: "S",
			redirectURI: AppConfig.nativeCallbackURL
		)

		guard case .failure(let error) = result else { return XCTFail("Expected .failure for a state mismatch, got \(result)") }
		XCTAssertEqual((error as? AuthFlowError)?.errorDescription, AuthFlowError.stateMismatch.errorDescription)
		XCTAssertFalse(session.isLoggedIn)
		XCTAssertTrue(StubURLProtocol.records.isEmpty, "a rejected callback must not exchange the code")
	}

	func testForceLogoutClearsTheMintedSessionCookie() async {
		let config = TestSupport.stubbedConfiguration()
		config.httpCookieStorage?.setCookie(TestSupport.sessionCookie(value: "sess-abc"))
		var readerWipeInvoked = false
		let session = AppSession(
			store: TestSupport.loggedInStore(),
			sessionConfiguration: config,
			wipeReaderWebStore: { readerWipeInvoked = true }
		)

		let readerWipe = session.forceLogout()

		XCTAssertFalse(session.isLoggedIn)
		XCTAssertNil(
			config.httpCookieStorage?.cookies?.first { $0.name == "hutch_sid" },
			"the minted session cookie must not survive a forced sign-out"
		)
		await readerWipe.value
		XCTAssertTrue(
			readerWipeInvoked,
			"sign-out must wipe the reader's traces from the WebKit store"
		)
	}

	func testLogoutClearsTheMintedSessionCookie() async {
		let config = TestSupport.stubbedConfiguration()
		config.httpCookieStorage?.setCookie(TestSupport.sessionCookie(value: "sess-abc"))
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		var readerWipeInvoked = false
		let session = AppSession(
			store: TestSupport.loggedInStore(),
			sessionConfiguration: config,
			wipeReaderWebStore: { readerWipeInvoked = true }
		)

		await session.logout()

		XCTAssertFalse(session.isLoggedIn)
		XCTAssertNil(
			config.httpCookieStorage?.cookies?.first { $0.name == "hutch_sid" },
			"the minted session cookie must not survive sign-out"
		)
		XCTAssertTrue(
			readerWipeInvoked,
			"sign-out must wipe the reader's traces from the WebKit store"
		)
	}

	func testLogoutPurgesShareArtifacts() async {
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		var purges = 0
		let session = AppSession(
			store: TestSupport.loggedInStore(),
			sessionConfiguration: TestSupport.stubbedConfiguration(),
			wipeReaderWebStore: {},
			purgeShareArtifacts: { purges += 1 }
		)

		await session.logout()

		XCTAssertEqual(
			purges, 1,
			"captured page bytes and cached queue responses must not outlive the session that authorised them"
		)
	}

	func testForceLogoutPurgesShareArtifacts() async {
		var purges = 0
		let session = AppSession(
			store: TestSupport.loggedInStore(),
			sessionConfiguration: TestSupport.stubbedConfiguration(),
			wipeReaderWebStore: {},
			purgeShareArtifacts: { purges += 1 }
		)

		let readerWipe = session.forceLogout()

		XCTAssertEqual(
			purges, 1,
			"a session invalidated behind the user's back leaves the same App Group traces a deliberate sign-out does"
		)
		await readerWipe.value
	}

	func testSignOutWipesTheSessionCookieRegardlessOfItsName() async {
		// A4: sign-out scrubs the API session by clearing every cookie in the app's
		// isolated jar, not one matched by a hard-coded `hutch_sid`. Seed the cookie
		// under a DIFFERENT name than today's and assert it is gone too — a name-based
		// scrub (the implementation this replaced) would leave it behind, so this is the
		// assertion that fails if the wholesale wipe regresses to matching a fixed name.
		let config = TestSupport.stubbedConfiguration()
		config.httpCookieStorage?.setCookie(TestSupport.sessionCookie(value: "sess-abc", name: "hutch_session_renamed"))
		let session = AppSession(
			store: TestSupport.loggedInStore(),
			sessionConfiguration: config,
			wipeReaderWebStore: {}
		)

		let readerWipe = session.forceLogout()

		XCTAssertEqual(
			config.httpCookieStorage?.cookies?.count, 0,
			"sign-out clears every cookie in the app's jar, not only one matched by the known session-cookie name"
		)
		await readerWipe.value
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

		let viewModel = ReadingListViewModel(api: session.makeAPI(), jobs: nil, onSessionExpired: {})
		await viewModel.loadIfNeeded()

		XCTAssertEqual(viewModel.articles.map(\.id), ["a1", "a2"])
		XCTAssertNil(viewModel.errorText)
		XCTAssertFalse(viewModel.isLoading)

		// Proves the bearer token + Siren Accept survived the entry-point 303.
		let queueRequest = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first?.request)
		XCTAssertEqual(queueRequest.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
		XCTAssertEqual(queueRequest.value(forHTTPHeaderField: "Accept"), "application/vnd.siren+json")
	}

	func testCallbackCarryingAnErrorParamIsDeniedWithoutExchanging() async {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())

		let result = await session.completeSignIn(
			callbackURL: URL(string: "\(AppConfig.nativeCallbackURL)?error=access_denied&state=S")!,
			verifier: "v", expectedState: "S", redirectURI: AppConfig.nativeCallbackURL
		)

		guard case .failure(let error) = result else { return XCTFail("expected .failure, got \(result)") }
		XCTAssertEqual((error as? AuthFlowError)?.errorDescription, AuthFlowError.denied("access_denied").errorDescription)
		XCTAssertFalse(session.isLoggedIn)
		XCTAssertTrue(StubURLProtocol.records(path: "/oauth/token").isEmpty, "a denied authorization exchanges no code")
	}

	func testCallbackWithoutACodeIsMissingCodeWithoutExchanging() async {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())

		let result = await session.completeSignIn(
			callbackURL: URL(string: "\(AppConfig.nativeCallbackURL)?state=S")!,
			verifier: "v", expectedState: "S", redirectURI: AppConfig.nativeCallbackURL
		)

		guard case .failure(let error) = result else { return XCTFail("expected .failure, got \(result)") }
		XCTAssertEqual((error as? AuthFlowError)?.errorDescription, AuthFlowError.missingCode.errorDescription)
		XCTAssertTrue(StubURLProtocol.records(path: "/oauth/token").isEmpty)
	}

	func testExchangeFailureDuringSignInSurfacesAsFailureAndStaysLoggedOut() async {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
		StubURLProtocol.setHandler { _, _ in .json(400, "{\"error\":\"invalid_grant\"}") }

		let result = await session.completeSignIn(
			callbackURL: URL(string: "\(AppConfig.nativeCallbackURL)?code=abc&state=S")!,
			verifier: "v", expectedState: "S", redirectURI: AppConfig.nativeCallbackURL
		)

		guard case .failure(let error) = result else { return XCTFail("expected .failure, got \(result)") }
		XCTAssertEqual(
			(error as? OAuthError)?.errorDescription,
			OAuthError.tokenExchangeFailed(status: 400).errorDescription
		)
		XCTAssertFalse(session.isLoggedIn)
	}
}
