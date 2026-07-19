import Foundation
import Security

/// Stores the OAuth token strings as generic-password Keychain items shared
/// between the app and its share extension. The App Group id is used as the
/// Keychain access group — an app-group entitlement doubles as a keychain access
/// group — so the two targets already share these items without a separate
/// keychain-sharing entitlement. Items use `AfterFirstUnlockThisDeviceOnly` so
/// the background share extension can read them after the first unlock, while
/// they never sync to iCloud or restore onto another device.
struct KeychainTokenStorage: TokenStorage {
	private let accessGroup: String
	private let service = "com.readplace.oauth"

	init(accessGroup: String) {
		self.accessGroup = accessGroup
	}

	private func baseQuery(for key: TokenKey) -> [String: Any] {
		[
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: key.rawValue,
			kSecAttrAccessGroup as String: accessGroup,
		]
	}

	func readValue(for key: TokenKey) -> Result<String?, KeychainError> {
		var query = baseQuery(for: key)
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var result: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &result)
		return Self.readResult(status: status, data: result as? Data)
	}

	/// Maps a `SecItemCopyMatching` outcome to a token value: a decodable item →
	/// its string; `errSecItemNotFound` → `.success(nil)` (a legitimately empty
	/// slot); any other status → `.failure` carrying the `OSStatus`. Pure and
	/// static so the failure path is unit-testable without a device — the Simulator
	/// Keychain ignores access groups and never returns `errSecMissingEntitlement`,
	/// so the on-device failure this exists to surface can only be exercised here.
	static func readResult(status: OSStatus, data: Data?) -> Result<String?, KeychainError> {
		switch status {
		case errSecSuccess:
			guard let data, let string = String(data: data, encoding: .utf8) else { return .success(nil) }
			return .success(string)
		case errSecItemNotFound:
			return .success(nil)
		default:
			return .failure(.read(status: status))
		}
	}

	func setValue(_ value: String, for key: TokenKey) {
		let payload: [String: Any] = [
			kSecValueData as String: Data(value.utf8),
			kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
		]
		let status = SecItemUpdate(baseQuery(for: key) as CFDictionary, payload as CFDictionary)
		if status == errSecItemNotFound {
			var insert = baseQuery(for: key)
			insert.merge(payload) { _, new in new }
			SecItemAdd(insert as CFDictionary, nil)
		}
	}

	func removeValue(for key: TokenKey) {
		SecItemDelete(baseQuery(for: key) as CFDictionary)
	}
}
