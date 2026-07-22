import XCTest
@testable import Readplace

/// Coverage of the "Sign up" journey end to end through the real production types:
/// the native authorize request it builds, the in-app auth session that presents it
/// over https, and the `readplace://oauth-callback` redirect that session captures
/// and feeds straight into the token exchange. The network is faked by
/// `StubURLProtocol`; the auth session is a fake presenter so no UI launches.
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

	func testSignupJourneySignsTheSessionInThroughTheCapturedCallback() async throws {
		let store = TokenStore(defaults: TestSupport.ephemeralDefaults())
		let session = AppSession(store: store, sessionConfiguration: TestSupport.stubbedConfiguration())
		let request = makeService(store: TestSupport.loggedInStore()).makeSignupAuthorizationRequest()
		XCTAssertFalse(session.isLoggedIn)

		StubURLProtocol.setHandler { request, _ in
			XCTAssertEqual(request.url?.path, "/oauth/token")
			return .json(200, Fixtures.tokenResponse(access: "fresh-access", refresh: "fresh-refresh"))
		}

		let flow = initWebAuthFlow(deps: WebAuthFlowDependencies(
			present: { _ in
				let callback = "\(AppConfig.nativeCallbackURL)?code=abc&state=\(request.state)"
				return .success(.returned(callbackURL: URL(string: callback)!))
			},
			exchange: { callbackURL, request in
				await session.completeSignIn(
					callbackURL: callbackURL,
					verifier: request.codeVerifier,
					expectedState: request.state,
					redirectURI: request.redirectURI
				)
			}
		))

		let result = await flow.start(request)

		guard case .success? = result else { return XCTFail("Expected .success, got \(String(describing: result))") }
		XCTAssertTrue(session.isLoggedIn, "RootView keys off isLoggedIn to show the reading list")
		XCTAssertEqual(store.tokens?.accessToken, "fresh-access", "token must be persisted for the share extension")
		XCTAssertEqual(store.tokens?.refreshToken, "fresh-refresh")
	}

	func testNativeCallbackURLPinnedToServerRegisteredValue() {
		// Pinned cross-language contract: the server registers this exact string as
		// a redirect_uri for the ios-app client and matches it by exact string at
		// token time. A change here must be mirrored on the server, and composing
		// the URI from scheme + host keeps the auth session's callbackURLScheme in step.
		XCTAssertEqual(AppConfig.nativeCallbackURL, "readplace://oauth-callback")
		XCTAssertEqual(AppConfig.callbackURLScheme, "readplace")
		XCTAssertEqual(AppConfig.nativeCallbackHost, "oauth-callback")
	}
}
