import Foundation

/// App-wide auth/session state. Exposes factories for the API and OAuth
/// services so views never construct them with stale config.
@MainActor
final class AppSession: ObservableObject {
	@Published private(set) var isLoggedIn: Bool

	private let store: TokenStore
	private let sessionConfiguration: URLSessionConfiguration

	init(store: TokenStore = TokenStore(), sessionConfiguration: URLSessionConfiguration = .default) {
		self.store = store
		self.sessionConfiguration = sessionConfiguration
		self.isLoggedIn = store.isLoggedIn
	}

	func refreshLoginState() {
		isLoggedIn = store.isLoggedIn
	}

	/// Completes the in-app WKWebView login: forwards to the redirect-aware
	/// overload with the https callback, so the token exchange's `redirect_uri`
	/// matches the one the WKWebView flow authorized with.
	func completeSignIn(
		callbackURL: URL,
		verifier: String,
		expectedState: String,
		onExchangeStarted: () -> Void
	) async -> Result<Void, Error> {
		await completeSignIn(
			callbackURL: callbackURL,
			verifier: verifier,
			expectedState: expectedState,
			redirectURI: makeOAuth().redirectURI,
			onExchangeStarted: onExchangeStarted
		)
	}

	/// Completes sign-in after the authorization web flow redirects to the
	/// callback URL: validate the callback, exchange the code for tokens, flip
	/// the session to logged-in. The deterministic half of the OAuth flow — the
	/// preceding web redirect (WKWebView for login, external browser for signup)
	/// is the OS boundary, exercised by hand.
	///
	/// `redirectURI` must equal the one the authorize request used, because the
	/// OAuth server checks it by exact string at token time: the https callback
	/// for WKWebView login, the native custom scheme for external-browser signup.
	///
	/// `onExchangeStarted` fires once, only after the callback validates and the
	/// network code exchange begins — never for a rejected callback — so the
	/// caller's "Signing in…" overlay appears only when sign-in is under way.
	func completeSignIn(
		callbackURL: URL,
		verifier: String,
		expectedState: String,
		redirectURI: String,
		onExchangeStarted: () -> Void
	) async -> Result<Void, Error> {
		let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
		func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

		if let error = value("error") { return .failure(AuthFlowError.denied(error)) }
		guard let code = value("code") else { return .failure(AuthFlowError.missingCode) }
		guard value("state") == expectedState else { return .failure(AuthFlowError.stateMismatch) }

		do {
			onExchangeStarted()
			try await makeOAuth().exchangeCode(code, verifier: verifier, redirectURI: redirectURI)
			refreshLoginState()
			return .success(())
		} catch {
			return .failure(error)
		}
	}

	/// Graceful sign-out: revoke server-side, then clear and flip state.
	func logout() async {
		await makeOAuth().revoke()
		isLoggedIn = false
	}

	/// Local sign-out used when the session is already invalid (refresh failed).
	func forceLogout() {
		store.clear()
		isLoggedIn = false
	}

	func makeAPI() -> ReadplaceAPI {
		ReadplaceAPI(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: sessionConfiguration)
	}

	func makeOAuth() -> OAuthService {
		OAuthService(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: sessionConfiguration)
	}
}
