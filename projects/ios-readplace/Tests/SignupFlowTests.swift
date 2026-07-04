import XCTest
@testable import Readplace

/// Coverage of the external-browser "Sign up" flow: the native authorize request
/// it builds, the `readplace://oauth-callback` deep link that finishes it, the
/// Chrome-scheme selection, and the App-Group persistence that lets it survive a
/// cold relaunch. The network is faked by `StubURLProtocol`; the browser is a
/// fake opener so no UI launches.
@MainActor
final class SignupFlowTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeService(store: TokenStore) -> OAuthService {
		OAuthService(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
	}

	func testSignupAuthorizationRequestUsesNativeRedirectAndScreenHint() {
		let request = makeService(store: TestSupport.loggedInStore()).makeSignupAuthorizationRequest()

		let components = URLComponents(url: request.url, resolvingAgainstBaseURL: false)!
		XCTAssertEqual(components.host, URL(string: AppConfig.serverBaseURL)?.host)
		XCTAssertEqual(components.path, "/oauth/authorize")
		let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
		XCTAssertEqual(items["client_id"], "ios-app")
		XCTAssertEqual(items["redirect_uri"], AppConfig.nativeCallbackURL)
		XCTAssertEqual(items["response_type"], "code")
		XCTAssertEqual(items["code_challenge_method"], "S256")
		XCTAssertEqual(items["screen_hint"], "signup")
		XCTAssertEqual(items["code_challenge"], PKCE.challenge(for: request.codeVerifier))
		XCTAssertFalse((items["state"] ?? "").isEmpty)
		XCTAssertEqual(request.redirectURI, AppConfig.nativeCallbackURL)
	}

	func testCallbackDeepLinkCompletesSignInWithNativeRedirect() async throws {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
		let pendingStore = PendingAuthStore(defaults: TestSupport.ephemeralDefaults())
		pendingStore.save(PendingAuth(verifier: "v", state: "S", redirectURI: AppConfig.nativeCallbackURL))
		XCTAssertFalse(session.isLoggedIn)

		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.url?.path, "/oauth/token")
			return .json(200, Fixtures.tokenResponse(access: "fresh-access", refresh: "fresh-refresh"))
		}

		let flow = initWebAuthFlow(deps: WebAuthFlowDependencies(
			pendingStore: pendingStore,
			canOpenURL: { _ in false },
			openURL: { _ in },
			exchange: { callbackURL, pending in
				await session.completeSignIn(
					callbackURL: callbackURL,
					verifier: pending.verifier,
					expectedState: pending.state,
					redirectURI: pending.redirectURI
				)
			}
		))

		let result = await flow.complete(URL(string: "\(AppConfig.nativeCallbackURL)?code=abc&state=S")!)

		guard case .success? = result else { return XCTFail("Expected .success, got \(String(describing: result))") }
		XCTAssertTrue(session.isLoggedIn, "RootView keys off isLoggedIn to show the reading list")
		XCTAssertEqual(store.tokens?.accessToken, "fresh-access")
		XCTAssertNil(pendingStore.load(), "the pending record must be cleared once the callback is consumed")

		let body = TestSupport.formFields(try XCTUnwrap(StubURLProtocol.records(path: "/oauth/token").first).body)
		XCTAssertEqual(body["grant_type"], "authorization_code")
		XCTAssertEqual(body["code"], "abc")
		XCTAssertEqual(body["code_verifier"], "v")
		XCTAssertEqual(body["client_id"], "ios-app")
		XCTAssertEqual(body["redirect_uri"], AppConfig.nativeCallbackURL)
	}

	func testChromeURLForHTTPSRewritesSchemeWhenChromeAvailable() {
		let https = URL(string: "https://readplace.com/oauth/authorize?client_id=ios-app&state=abc")!
		var probed: URL?
		let chrome = chromeURLForHTTPS(https, canOpen: { probed = $0; return true })

		XCTAssertEqual(probed?.scheme, "googlechromes", "Chrome availability is probed with the https scheme variant")
		let components = URLComponents(url: chrome, resolvingAgainstBaseURL: false)!
		XCTAssertEqual(components.scheme, "googlechromes")
		XCTAssertEqual(components.host, URL(string: AppConfig.serverBaseURL)?.host)
		XCTAssertEqual(components.path, "/oauth/authorize")
		XCTAssertEqual(components.percentEncodedQuery, "client_id=ios-app&state=abc")
	}

	func testChromeURLForHTTPSReturnsHTTPSUnchangedWhenChromeUnavailable() {
		let https = URL(string: "https://readplace.com/oauth/authorize?client_id=ios-app&state=abc")!
		let fallback = chromeURLForHTTPS(https, canOpen: { _ in false })

		XCTAssertEqual(fallback, https)
		XCTAssertEqual(fallback.absoluteString, https.absoluteString)
	}

	func testPendingAuthStoreRoundTrip() {
		let store = PendingAuthStore(defaults: TestSupport.ephemeralDefaults())
		XCTAssertNil(store.load())

		let pending = PendingAuth(verifier: "ver", state: "st", redirectURI: AppConfig.nativeCallbackURL)
		store.save(pending)
		XCTAssertEqual(store.load(), pending)

		store.clear()
		XCTAssertNil(store.load())
	}

	func testSignupFlowPersistsSecretsBeforeOpeningBrowser() throws {
		let store = PendingAuthStore(defaults: TestSupport.ephemeralDefaults())
		let oauth = makeService(store: TestSupport.loggedInStore())

		var openedURL: URL?
		var pendingWhenOpened: PendingAuth?
		let flow = initWebAuthFlow(deps: WebAuthFlowDependencies(
			pendingStore: store,
			canOpenURL: { _ in false },
			openURL: { url in
				openedURL = url
				pendingWhenOpened = store.load()
			},
			exchange: { _, _ in .success(()) }
		))

		flow.start(oauth.makeSignupAuthorizationRequest())

		let pending = try XCTUnwrap(pendingWhenOpened, "secrets must be persisted before the browser opens — a kill mid-hop must not lose them")
		XCTAssertEqual(store.load(), pending, "the persisted record must outlive start()")
		XCTAssertEqual(pending.redirectURI, AppConfig.nativeCallbackURL)

		let opened = try XCTUnwrap(openedURL)
		let items = Dictionary(uniqueKeysWithValues: (URLComponents(url: opened, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
		XCTAssertEqual(items["state"], pending.state, "the opened authorize URL carries the persisted state")
		XCTAssertEqual(items["redirect_uri"], AppConfig.nativeCallbackURL)
		XCTAssertEqual(items["screen_hint"], "signup")
	}

	func testNativeCallbackURLPinnedToServerRegisteredValue() {
			// Pinned cross-language contract: the server registers this exact string as
	// a redirect_uri for the ios-app client and matches it by exact string at
	// token time. A change here must be mirrored on the server, and composing
	// the URI from scheme + host keeps the deep-link parser in step.
		XCTAssertEqual(AppConfig.nativeCallbackURL, "readplace://oauth-callback")
		XCTAssertEqual(AppConfig.callbackURLScheme, "readplace")
		XCTAssertEqual(AppConfig.nativeCallbackHost, "oauth-callback")
	}
}
