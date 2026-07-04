import XCTest
@testable import Readplace

final class TokenStoreTests: XCTestCase {
	private func makeStore() -> TokenStore {
		TokenStore(defaults: TestSupport.ephemeralDefaults())
	}

	func testStartsLoggedOut() {
		let store = makeStore()
		XCTAssertNil(store.tokens)
		XCTAssertFalse(store.isLoggedIn)
	}

	func testSaveAndReadTokens() {
		let store = makeStore()
		store.save(OAuthTokens(accessToken: "a", refreshToken: "r"))
		XCTAssertEqual(store.tokens, OAuthTokens(accessToken: "a", refreshToken: "r"))
		XCTAssertTrue(store.isLoggedIn)
	}

	func testUpdateAccessTokenKeepsRefreshWhenNil() {
		let store = makeStore()
		store.save(OAuthTokens(accessToken: "a", refreshToken: "r"))
		store.updateAccessToken("a2", refreshToken: nil)
		XCTAssertEqual(store.tokens?.accessToken, "a2")
		XCTAssertEqual(store.tokens?.refreshToken, "r")
	}

	func testUpdateAccessTokenReplacesRefreshWhenProvided() {
		let store = makeStore()
		store.save(OAuthTokens(accessToken: "a", refreshToken: "r"))
		store.updateAccessToken("a2", refreshToken: "r2")
		XCTAssertEqual(store.tokens?.refreshToken, "r2")
	}

	func testClearRemovesTokens() {
		let store = makeStore()
		store.save(OAuthTokens(accessToken: "a", refreshToken: "r"))
		store.clear()
		XCTAssertNil(store.tokens)
		XCTAssertFalse(store.isLoggedIn)
	}

	func testPartialTokensAreTreatedAsLoggedOut() {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("only-access", forKey: "oauth.accessToken")
		let store = TokenStore(defaults: defaults)
		XCTAssertNil(store.tokens, "a missing refresh token should not count as logged in")
	}

	func testMigratesLegacyDefaultsIntoStorage() {
		let legacy = TestSupport.ephemeralDefaults()
		legacy.set("legacy-access", forKey: TokenKey.accessToken.rawValue)
		legacy.set("legacy-refresh", forKey: TokenKey.refreshToken.rawValue)
		let target = UserDefaultsTokenStorage(defaults: TestSupport.ephemeralDefaults())

		TokenStore.migrateLegacyDefaults(from: legacy, into: target)

		XCTAssertEqual(target.value(for: .accessToken), "legacy-access")
		XCTAssertEqual(target.value(for: .refreshToken), "legacy-refresh")
		XCTAssertNil(legacy.string(forKey: TokenKey.accessToken.rawValue), "legacy copy is cleared after migrating")
	}

	func testMigrationLeavesExistingStorageTokensUntouched() {
		let legacy = TestSupport.ephemeralDefaults()
		legacy.set("legacy-access", forKey: TokenKey.accessToken.rawValue)
		legacy.set("legacy-refresh", forKey: TokenKey.refreshToken.rawValue)
		let target = UserDefaultsTokenStorage(defaults: TestSupport.ephemeralDefaults())
		target.setValue("keychain-access", for: .accessToken)
		target.setValue("keychain-refresh", for: .refreshToken)

		TokenStore.migrateLegacyDefaults(from: legacy, into: target)

		XCTAssertEqual(target.value(for: .accessToken), "keychain-access", "an existing session must not be overwritten")
		XCTAssertEqual(legacy.string(forKey: TokenKey.accessToken.rawValue), "legacy-access", "legacy is left intact when nothing migrates")
	}

	func testMigrationClearsPartialLegacyWithoutLoggingIn() {
		let legacy = TestSupport.ephemeralDefaults()
		legacy.set("only-access", forKey: TokenKey.accessToken.rawValue)
		let target = UserDefaultsTokenStorage(defaults: TestSupport.ephemeralDefaults())

		TokenStore.migrateLegacyDefaults(from: legacy, into: target)

		XCTAssertNil(target.value(for: .accessToken), "a partial legacy token is not a valid session")
		XCTAssertNil(legacy.string(forKey: TokenKey.accessToken.rawValue), "the stray partial token is cleared")
	}

	// MARK: - parseAppGroupId (embedded provisioning profile)

	private func profile(_ innerPlist: String) -> Data {
		// A .mobileprovision is a CMS blob with a plist inside; the parser only
		// scans out the <?xml…</plist> slice, so wrapping it in arbitrary bytes
		// models the real container without needing a signed profile.
		Data("....signature-bytes....\(innerPlist)....trailer....".utf8)
	}

	func testParsesTheFirstApplicationGroupFromAProfile() {
		let plist = """
		<?xml version="1.0" encoding="UTF-8"?>
		<plist version="1.0"><dict>
		<key>Entitlements</key><dict>
		<key>com.apple.security.application-groups</key>
		<array><string>group.com.rewritten.readplace</string><string>group.other</string></array>
		</dict></dict></plist>
		"""
		XCTAssertEqual(
			TokenStore.parseAppGroupId(fromProvisioningProfile: profile(plist)),
			"group.com.rewritten.readplace"
		)
	}

	func testReturnsNilWhenTheProfileHasNoPlist() {
		XCTAssertNil(TokenStore.parseAppGroupId(fromProvisioningProfile: Data("no plist here".utf8)))
	}

	func testReturnsNilWhenTheProfileHasNoAppGroupEntitlement() {
		let plist = """
		<?xml version="1.0" encoding="UTF-8"?>
		<plist version="1.0"><dict>
		<key>Entitlements</key><dict><key>application-identifier</key><string>ABCDE.com.x</string></dict>
		</dict></plist>
		"""
		XCTAssertNil(TokenStore.parseAppGroupId(fromProvisioningProfile: profile(plist)))
	}

	func testReturnsNilWhenTheAppGroupArrayIsEmpty() {
		let plist = """
		<?xml version="1.0" encoding="UTF-8"?>
		<plist version="1.0"><dict>
		<key>Entitlements</key><dict>
		<key>com.apple.security.application-groups</key><array></array>
		</dict></dict></plist>
		"""
		XCTAssertNil(TokenStore.parseAppGroupId(fromProvisioningProfile: profile(plist)))
	}
}
