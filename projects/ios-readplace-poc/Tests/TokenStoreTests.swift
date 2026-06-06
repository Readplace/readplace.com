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

	func testBaseURLDefaultsToConfig() {
		XCTAssertEqual(makeStore().baseURL, AppConfig.defaultBaseURL)
	}

	func testBaseURLPersists() {
		let store = makeStore()
		store.baseURL = "https://example.test"
		XCTAssertEqual(store.baseURL, "https://example.test")
	}

	func testPartialTokensAreTreatedAsLoggedOut() {
		let defaults = TestSupport.ephemeralDefaults()
		defaults.set("only-access", forKey: "oauth.accessToken")
		let store = TokenStore(defaults: defaults)
		XCTAssertNil(store.tokens, "a missing refresh token should not count as logged in")
	}
}
