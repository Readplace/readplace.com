import Foundation

/// The OAuth token pair persisted for the app and share extension.
struct OAuthTokens: Equatable {
	let accessToken: String
	let refreshToken: String
}

/// The two persisted token strings, addressed by a stable account key.
enum TokenKey: String, CaseIterable {
	case accessToken = "oauth.accessToken"
	case refreshToken = "oauth.refreshToken"
}

/// Why a Keychain read failed, carrying the raw `OSStatus`. A read that finds no
/// item is NOT an error — it is a legitimately signed-out state (`.success(nil)`);
/// only a hard failure (e.g. `errSecMissingEntitlement`, `errSecInteractionNotAllowed`)
/// becomes a `.read`, so the share extension can report the real reason instead of
/// a misleading "not signed in".
enum KeychainError: Error, Equatable {
	case read(status: OSStatus)

	var status: OSStatus {
		switch self {
		case .read(let status): return status
		}
	}
}

/// Backing store for the OAuth token strings. Production is Keychain-backed and
/// shared across the app and its share extension; tests inject a `UserDefaults`
/// double via `TokenStore(defaults:)`.
///
/// `readValue` distinguishes "no token stored" (`.success(nil)`) from "the store
/// could not be read" (`.failure`) — the distinction the share extension needs so
/// an unreadable Keychain is never silently reported as a signed-out account.
protocol TokenStorage {
	func readValue(for key: TokenKey) -> Result<String?, KeychainError>
	func setValue(_ value: String, for key: TokenKey)
	func removeValue(for key: TokenKey)
}

extension TokenStorage {
	/// The token string, or nil when it is absent OR unreadable. The app's own
	/// session gating collapses both to "signed out" (it will re-authenticate); the
	/// share extension reads through `readValue` to tell the two apart.
	func value(for key: TokenKey) -> String? {
		switch readValue(for: key) {
		case .success(let stored): return stored
		case .failure: return nil
		}
	}
}

/// Adapts a `UserDefaults` suite to `TokenStorage`. Backs the test seam and reads
/// tokens left behind by pre-Keychain builds during migration; a `UserDefaults`
/// read cannot fail, so it never yields a `.failure`.
struct UserDefaultsTokenStorage: TokenStorage {
	let defaults: UserDefaults
	func readValue(for key: TokenKey) -> Result<String?, KeychainError> {
		.success(defaults.string(forKey: key.rawValue))
	}
	func setValue(_ value: String, for key: TokenKey) { defaults.set(value, forKey: key.rawValue) }
	func removeValue(for key: TokenKey) { defaults.removeObject(forKey: key.rawValue) }
}

/// Persists OAuth tokens so the app (which signs in) and the share extension
/// (which saves) agree on identity. Tokens live in the Keychain — shared between
/// the two targets through the App Group used as the Keychain access group — so
/// they are hardware-encrypted and excluded from unencrypted device backups,
/// unlike the App Group `UserDefaults` earlier builds used. The server they
/// target is fixed at compile time in `AppConfig.serverBaseURL`, not stored here.
struct TokenStore {
	private let storage: TokenStorage

	init() {
		let group = TokenStore.resolvedAppGroupId
		let keychain = KeychainTokenStorage(accessGroup: group)
		if let legacy = UserDefaults(suiteName: group) {
			TokenStore.migrateLegacyDefaults(from: legacy, into: keychain)
		}
		self.storage = keychain
	}

	/// Injectable backing store for tests.
	init(defaults: UserDefaults) {
		self.init(storage: UserDefaultsTokenStorage(defaults: defaults))
	}

	/// Injectable backing store — the seam a composition root or a test uses to
	/// supply its own `TokenStorage` (e.g. one that models an unreadable Keychain).
	init(storage: TokenStorage) {
		self.storage = storage
	}

	/// The App Group id this process is actually entitled to. A sideloader
	/// (AltStore/Sideloadly) may rewrite the declared id when re-signing, so we
	/// read it back from the embedded provisioning profile rather than trusting
	/// the compile-time constant. Falls back to the constant when unavailable.
	static let resolvedAppGroupId: String = {
		guard
			let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
			let data = try? Data(contentsOf: url),
			let group = parseAppGroupId(fromProvisioningProfile: data)
		else { return AppConfig.appGroupId }
		return group
	}()

	/// Extracts the first application-group entitlement from an embedded
	/// `.mobileprovision` blob, or nil when it can't be read. The profile is a
	/// CMS-signed container with a plist inside; the signature isn't verified here
	/// (the OS already did at install), so this just scans out the `<?xml…</plist>`
	/// slice and reads the entitlement. Pulled out of `resolvedAppGroupId` so the
	/// parsing is unit-testable without a real `Bundle.main`.
	static func parseAppGroupId(fromProvisioningProfile data: Data) -> String? {
		guard
			let raw = String(data: data, encoding: .isoLatin1),
			let start = raw.range(of: "<?xml"),
			let end = raw.range(of: "</plist>")
		else { return nil }
		let plistString = String(raw[start.lowerBound..<end.upperBound])
		guard
			let plistData = plistString.data(using: .isoLatin1),
			let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
			let entitlements = plist["Entitlements"] as? [String: Any],
			let groups = entitlements["com.apple.security.application-groups"] as? [String],
			let group = groups.first
		else { return nil }
		return group
	}

	var tokens: OAuthTokens? {
		guard
			let access = storage.value(for: .accessToken),
			let refresh = storage.value(for: .refreshToken)
		else { return nil }
		return OAuthTokens(accessToken: access, refreshToken: refresh)
	}

	/// Reads the token pair, distinguishing a genuinely signed-out store
	/// (`.success(nil)`) from one that could not be READ (`.failure`, carrying the
	/// Keychain `OSStatus`). The share extension needs the distinction so an
	/// unreadable shared Keychain surfaces as a real error rather than a false
	/// "not signed in"; the app's `tokens`/`isLoggedIn` collapse a failure to
	/// "signed out" and re-authenticate.
	func loadTokens() -> Result<OAuthTokens?, KeychainError> {
		switch storage.readValue(for: .accessToken) {
		case .failure(let error):
			return .failure(error)
		case .success(let access):
			guard let access else { return .success(nil) }
			switch storage.readValue(for: .refreshToken) {
			case .failure(let error):
				return .failure(error)
			case .success(let refresh):
				guard let refresh else { return .success(nil) }
				return .success(OAuthTokens(accessToken: access, refreshToken: refresh))
			}
		}
	}

	func save(_ tokens: OAuthTokens) {
		storage.setValue(tokens.accessToken, for: .accessToken)
		storage.setValue(tokens.refreshToken, for: .refreshToken)
	}

	func updateAccessToken(_ accessToken: String, refreshToken: String?) {
		storage.setValue(accessToken, for: .accessToken)
		if let refreshToken { storage.setValue(refreshToken, for: .refreshToken) }
	}

	func clear() {
		storage.removeValue(for: .accessToken)
		storage.removeValue(for: .refreshToken)
	}

	var isLoggedIn: Bool { tokens != nil }

	/// One-time move of tokens written by pre-Keychain builds out of the App Group
	/// `UserDefaults` into `storage`. The legacy copy is cleared only once the
	/// Keychain write reads back, so a misconfigured Keychain can't strand the
	/// tokens. No-op when `storage` already holds a token.
	static func migrateLegacyDefaults(from defaults: UserDefaults, into storage: TokenStorage) {
		guard storage.value(for: .accessToken) == nil else { return }
		let access = defaults.string(forKey: TokenKey.accessToken.rawValue)
		let refresh = defaults.string(forKey: TokenKey.refreshToken.rawValue)
		guard let access, let refresh else {
			clearLegacy(defaults)
			return
		}
		storage.setValue(access, for: .accessToken)
		storage.setValue(refresh, for: .refreshToken)
		if storage.value(for: .accessToken) != nil { clearLegacy(defaults) }
	}

	private static func clearLegacy(_ defaults: UserDefaults) {
		for key in TokenKey.allCases { defaults.removeObject(forKey: key.rawValue) }
	}
}
