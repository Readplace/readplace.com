import Foundation

/// The in-flight PKCE secrets for an external-browser auth attempt (Login or
/// Sign up), captured before the browser opens so the `readplace://oauth-callback`
/// deep link can finish the token exchange even after a cold relaunch (the app
/// may be terminated while Chrome runs the web flow).
struct PendingAuth: Equatable {
	let verifier: String
	let state: String
	let redirectURI: String
}

/// Persists a single `PendingAuth` in the shared App Group so it survives the
/// app being backgrounded — or killed — during the external-browser hop. The
/// backing `UserDefaults` is injected (the App Group suite in the running app,
/// an ephemeral suite in tests) rather than resolved here.
struct PendingAuthStore {
	private let defaults: UserDefaults

	private enum Key {
		static let verifier = "auth.pending.verifier"
		static let state = "auth.pending.state"
		static let redirectURI = "auth.pending.redirectURI"
	}

	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	func save(_ pending: PendingAuth) {
		defaults.set(pending.verifier, forKey: Key.verifier)
		defaults.set(pending.state, forKey: Key.state)
		defaults.set(pending.redirectURI, forKey: Key.redirectURI)
	}

	func load() -> PendingAuth? {
		guard
			let verifier = defaults.string(forKey: Key.verifier),
			let state = defaults.string(forKey: Key.state),
			let redirectURI = defaults.string(forKey: Key.redirectURI)
		else { return nil }
		return PendingAuth(verifier: verifier, state: state, redirectURI: redirectURI)
	}

	func clear() {
		defaults.removeObject(forKey: Key.verifier)
		defaults.removeObject(forKey: Key.state)
		defaults.removeObject(forKey: Key.redirectURI)
	}
}
