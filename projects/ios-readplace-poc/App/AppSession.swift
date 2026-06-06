import Foundation

/// App-wide auth/session state. Owns the base URL and exposes factories for
/// the API and OAuth services so views never construct them with stale config.
@MainActor
final class AppSession: ObservableObject {
	@Published private(set) var isLoggedIn: Bool
	@Published var baseURL: String

	private let store: TokenStore

	init() {
		let store = TokenStore()
		self.store = store
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

	func makeAPI() -> ReadplaceAPI { ReadplaceAPI(baseURL: store.baseURL, store: store) }
	func makeOAuth() -> OAuthService { OAuthService(baseURL: store.baseURL, store: store) }
}
