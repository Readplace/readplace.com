import Foundation

/// Why the authorization callback was rejected before any token exchange. Raised
/// by `AppSession.completeSignIn` while validating the `readplace://oauth-callback`
/// deep link the external-browser auth flow returns through.
enum AuthFlowError: LocalizedError {
	case denied(String)
	case missingCode
	case stateMismatch

	var errorDescription: String? {
		switch self {
		case .denied(let reason): return "Authorization was denied (\(reason))."
		case .missingCode: return "No authorization code was returned."
		case .stateMismatch: return "Security check failed (state mismatch)."
		}
	}
}

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

	/// Completes sign-in after the authorization web flow redirects to the
	/// callback URL: validate the callback, exchange the code for tokens, flip
	/// the session to logged-in. The deterministic half of the OAuth flow — the
	/// preceding external-browser web redirect (for both Login and Sign up) is the
	/// OS boundary, exercised by hand.
	///
	/// `redirectURI` must equal the one the authorize request used, because the
	/// OAuth server checks it by exact string at token time: the native custom
	/// scheme the external-browser flow authorized with.
	func completeSignIn(
		callbackURL: URL,
		verifier: String,
		expectedState: String,
		redirectURI: String
	) async -> Result<Void, Error> {
		let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
		func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

		if let error = value("error") { return .failure(AuthFlowError.denied(error)) }
		guard let code = value("code") else { return .failure(AuthFlowError.missingCode) }
		guard value("state") == expectedState else { return .failure(AuthFlowError.stateMismatch) }

		do {
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
