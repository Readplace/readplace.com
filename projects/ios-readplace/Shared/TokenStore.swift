import Foundation

/// OAuth tokens issued by the server's `/oauth/token` endpoint.
struct OAuthTokens: Equatable {
	let accessToken: String
	let refreshToken: String
}

/// Persists OAuth tokens in the shared App Group so the app (which signs in)
/// and the share extension (which saves) agree on identity. The server they
/// target is fixed at compile time in `AppConfig.serverBaseURL`, not stored here.
struct TokenStore {
	private let defaults: UserDefaults

	private enum Key {
		static let accessToken = "oauth.accessToken"
		static let refreshToken = "oauth.refreshToken"
	}

	init() {
		let group = TokenStore.resolvedAppGroupId
		guard let defaults = UserDefaults(suiteName: group) else {
			preconditionFailure("App Group \(group) is required for the token store")
		}
		self.defaults = defaults
	}

	/// Injectable backing store for tests.
	init(defaults: UserDefaults) {
		self.defaults = defaults
	}

	/// The App Group id this process is actually entitled to. A sideloader
	/// (AltStore/Sideloadly) may rewrite the declared id when re-signing, so we
	/// read it back from the embedded provisioning profile rather than trusting
	/// the compile-time constant. Falls back to the constant when unavailable.
	static let resolvedAppGroupId: String = {
		guard
			let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
			let data = try? Data(contentsOf: url),
			let raw = String(data: data, encoding: .isoLatin1),
			let start = raw.range(of: "<?xml"),
			let end = raw.range(of: "</plist>")
		else { return AppConfig.appGroupId }
		let plistString = String(raw[start.lowerBound..<end.upperBound])
		guard
			let plistData = plistString.data(using: .isoLatin1),
			let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
			let entitlements = plist["Entitlements"] as? [String: Any],
			let groups = entitlements["com.apple.security.application-groups"] as? [String],
			let group = groups.first
		else { return AppConfig.appGroupId }
		return group
	}()

	var tokens: OAuthTokens? {
		guard
			let access = defaults.string(forKey: Key.accessToken),
			let refresh = defaults.string(forKey: Key.refreshToken)
		else { return nil }
		return OAuthTokens(accessToken: access, refreshToken: refresh)
	}

	func save(_ tokens: OAuthTokens) {
		defaults.set(tokens.accessToken, forKey: Key.accessToken)
		defaults.set(tokens.refreshToken, forKey: Key.refreshToken)
	}

	func updateAccessToken(_ accessToken: String, refreshToken: String?) {
		defaults.set(accessToken, forKey: Key.accessToken)
		if let refreshToken { defaults.set(refreshToken, forKey: Key.refreshToken) }
	}

	func clear() {
		defaults.removeObject(forKey: Key.accessToken)
		defaults.removeObject(forKey: Key.refreshToken)
	}

	var isLoggedIn: Bool { tokens != nil }
}
