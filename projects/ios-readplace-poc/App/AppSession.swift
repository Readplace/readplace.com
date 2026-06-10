import Foundation

/// App-wide auth/session state. Owns the base URL and exposes factories for
/// the API and OAuth services so views never construct them with stale config.
@MainActor
final class AppSession: ObservableObject {
	@Published private(set) var isLoggedIn: Bool
	@Published var baseURL: String

	private let store: TokenStore
	private let sessionConfiguration: URLSessionConfiguration

	init(store: TokenStore = TokenStore(), sessionConfiguration: URLSessionConfiguration = .default) {
		self.store = store
		self.sessionConfiguration = sessionConfiguration
		self.isLoggedIn = store.isLoggedIn
		self.baseURL = store.baseURL
	}

	/// Normalises and persists the server URL (so the share extension matches).
	func setBaseURL(_ raw: String) {
		var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		while trimmed.hasSuffix("/") { trimmed.removeLast() }
		guard !trimmed.isEmpty else { return }
		baseURL = trimmed
		store.baseURL = trimmed
	}

	func refreshLoginState() {
		isLoggedIn = store.isLoggedIn
	}

	/// Completes sign-in after the authorization web flow redirects to the
	/// callback URL: validate the callback, exchange the code for tokens, flip
	/// the session to logged-in. The deterministic half of the OAuth flow — the
	/// preceding WKWebView redirect is the OS boundary, exercised by hand.
	///
	/// `onExchangeStarted` fires once, only after the callback validates and the
	/// network code exchange begins — never for a rejected callback — so the
	/// caller's "Signing in…" overlay appears only when sign-in is under way.
	func completeSignIn(
		callbackURL: URL,
		verifier: String,
		expectedState: String,
		onExchangeStarted: () -> Void
	) async -> Result<Void, Error> {
		let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
		func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

		if let error = value("error") { return .failure(AuthFlowError.denied(error)) }
		guard let code = value("code") else { return .failure(AuthFlowError.missingCode) }
		guard value("state") == expectedState else { return .failure(AuthFlowError.stateMismatch) }

		do {
			onExchangeStarted()
			try await makeOAuth().exchangeCode(code, verifier: verifier)
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
		ReadplaceAPI(baseURL: store.baseURL, store: store, sessionConfiguration: sessionConfiguration)
	}

	func makeOAuth() -> OAuthService {
		OAuthService(baseURL: store.baseURL, store: store, sessionConfiguration: sessionConfiguration)
	}
}
