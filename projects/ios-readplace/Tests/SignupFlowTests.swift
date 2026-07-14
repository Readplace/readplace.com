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
			openAuthorizeURL: { _ in },
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

	func testChromeURLForHTTPSRewritesSchemeToGoogleChrome() throws {
		let https = URL(string: "\(AppConfig.serverBaseURL)/oauth/authorize?client_id=ios-app&state=abc")!
		let chrome = try XCTUnwrap(chromeURLFor(https))

		let components = try XCTUnwrap(URLComponents(url: chrome, resolvingAgainstBaseURL: false))
		XCTAssertEqual(components.scheme, "googlechromes", "https is rewritten to Chrome's https scheme variant")
		XCTAssertEqual(components.host, AppConfig.serverHost)
		XCTAssertEqual(components.path, "/oauth/authorize")
		XCTAssertEqual(components.percentEncodedQuery, "client_id=ios-app&state=abc")
	}

	func testChromeURLForHTTPRewritesSchemeToGoogleChromeInsecureVariant() throws {
		// Chrome's scheme for plain http is `googlechrome`, not `googlechromes`.
		let http = URL(string: "http://\(AppConfig.serverHost)/post?a=1")!
		let chrome = try XCTUnwrap(chromeURLFor(http))

		let components = try XCTUnwrap(URLComponents(url: chrome, resolvingAgainstBaseURL: false))
		XCTAssertEqual(components.scheme, "googlechrome")
		XCTAssertEqual(components.host, AppConfig.serverHost)
		XCTAssertEqual(components.path, "/post")
		XCTAssertEqual(components.percentEncodedQuery, "a=1")
	}

	func testChromeURLForNonWebSchemeHasNoChromeEquivalent() {
		// A mailto:/tel: link inside an article has no Chrome equivalent — stamping
		// `googlechromes` on it would yield a URL nothing can open.
		XCTAssertNil(chromeURLFor(URL(string: "mailto:hi@example.com")!))
		XCTAssertNil(chromeURLFor(URL(string: "tel:+61400000000")!))
	}

	func testChromeURLForLeavesAThirdPartyLinkAlone() {
		// A custom scheme can never be claimed by a Universal Link. Rewriting a
		// third-party article link would therefore stop it handing off to its native
		// app, and would override a default browser the user deliberately chose — for
		// a host where there is no Readplace session to reuse anyway.
		XCTAssertNil(chromeURLFor(URL(string: "https://apps.apple.com/au/app/id123")!))
		XCTAssertNil(chromeURLFor(URL(string: "https://www.youtube.com/watch?v=abc")!))
		XCTAssertNil(chromeURLFor(URL(string: "https://www.nytimes.com/2026/01/01/story.html")!))
	}

	func testOpenURLChromeFirstHandsAThirdPartyLinkStraightToTheSystem() {
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(true)
		})

		openURLChromeFirst(URL(string: "https://www.youtube.com/watch?v=abc")!, browser: browser)

		// The raw https URL, once — so iOS can resolve it as a Universal Link and hand
		// off to the YouTube app, or fall through to the user's own default browser.
		XCTAssertEqual(opened.map(\.absoluteString), ["https://www.youtube.com/watch?v=abc"])
	}

	func testOpenURLChromeFirstOpensChromeAndNeverFallsBackWhenChromeOpens() {
		let https = URL(string: "\(AppConfig.serverBaseURL)/oauth/authorize?client_id=ios-app&state=abc")!
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(true)
		})

		openURLChromeFirst(https, browser: browser)

		// The requirement: when Chrome opens, we must never touch the default
		// browser (Safari), where the user isn't signed in.
		XCTAssertEqual(opened.map(\.scheme), ["googlechromes"])
	}

	func testOpenURLChromeFirstFallsBackToHTTPSOnlyWhenChromeCannotOpen() {
		let https = URL(string: "\(AppConfig.serverBaseURL)/oauth/authorize?client_id=ios-app&state=abc")!
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(url.scheme == "https") // Chrome (googlechromes) can't open; https can
		})

		openURLChromeFirst(https, browser: browser)

		// Only a genuine Chrome-open failure (Chrome not installed) falls through to
		// the default browser with the original https URL.
		XCTAssertEqual(opened.map(\.scheme), ["googlechromes", "https"])
	}

	func testOpenURLChromeFirstHandsANonWebSchemeStraightToTheSystem() {
		var opened: [URL] = []
		let browser = ExternalBrowser(open: { url, completion in
			opened.append(url)
			completion(true)
		})

		openURLChromeFirst(URL(string: "mailto:hi@example.com")!, browser: browser)

		// No Chrome attempt at all — the system gets the URL untouched, once.
		XCTAssertEqual(opened.map(\.absoluteString), ["mailto:hi@example.com"])
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
			openAuthorizeURL: { url in
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
		XCTAssertEqual(opened.scheme, "https", "the core hands the raw https authorize URL to the seam; the Chrome rewrite lives in the App layer")
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
