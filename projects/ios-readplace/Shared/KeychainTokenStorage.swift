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

	func value(for key: TokenKey) -> String? {
		var query = baseQuery(for: key)
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var result: CFTypeRef?
		guard
			SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
			let data = result as? Data,
			let string = String(data: data, encoding: .utf8)
		else { return nil }
		return string
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
