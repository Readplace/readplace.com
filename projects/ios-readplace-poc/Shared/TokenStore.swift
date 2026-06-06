import Foundation

/// OAuth tokens issued by the server's `/oauth/token` endpoint.
struct OAuthTokens: Equatable {
	let accessToken: String
	let refreshToken: String
}

/// Persists tokens and the active base URL in the shared App Group so the
/// app and the share extension agree on identity and server.
///
/// A POC-grade store: UserDefaults in the shared container. (A production app
/// would keep tokens in the Keychain with a shared access group.)
struct TokenStore {
	private let defaults: UserDefaults

	private enum Key {
		static let accessToken = "oauth.accessToken"
		static let refreshToken = "oauth.refreshToken"
		static let baseURL = "config.baseURL"
	}

	init() {
		let group = TokenStore.resolvedAppGroupId
		/// Falls back to standard defaults so the app still runs where the App
		/// Group entitlement is missing — the share extension simply won't see
		/// the token until the group is enabled.
		defaults = UserDefaults(suiteName: group) ?? .standard
		NSLog("[ReadplacePOC] TokenStore group=\(group) shared=\(UserDefaults(suiteName: group) != nil)")
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

	var baseURL: String {
		get { defaults.string(forKey: Key.baseURL) ?? AppConfig.defaultBaseURL }
		nonmutating set { defaults.set(newValue, forKey: Key.baseURL) }
	}

	var isLoggedIn: Bool { tokens != nil }
}
