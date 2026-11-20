import XCTest
@testable import Readplace

final class StorefrontCountryTests: XCTestCase {
	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private func makeAPI(storefront: StorefrontCountryCode?) -> ReadplaceAPI {
		ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL, store: TestSupport.loggedInStore(), nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), readStorefront: { storefront }
		)
	}

	private func stubSessionMint() {
		StubURLProtocol.setHandler { _, _ in
			StubURLProtocol.Stub(status: 204, headers: ["Set-Cookie": "hutch_sid=sess-abc; Path=/; HttpOnly"])
		}
	}

	func testTheWireNamesMatchWhatTheServerReads() {
		XCTAssertEqual(AppConfig.storefrontHeader, "x-readplace-storefront")
		XCTAssertEqual(AppConfig.storefrontCookieName, "readplace_storefront")
	}

	func testBootstrapSessionAddsTheStorefrontCookieForTheServerHostWhenTheStorefrontIsKnown() async throws {
		stubSessionMint()

		let cookies = try await makeAPI(storefront: StorefrontCountryCode(raw: "CHN")).bootstrapSession()

		XCTAssertEqual(cookies.map(\.name), ["hutch_sid", AppConfig.storefrontCookieName])
		let storefront = try XCTUnwrap(cookies.last)
		XCTAssertEqual(storefront.value, "CHN")
		XCTAssertEqual(storefront.domain, AppConfig.serverHost)
		XCTAssertEqual(storefront.path, "/")
		XCTAssertTrue(storefront.isSecure, "the storefront cookie must only travel over HTTPS")
	}

	func testBootstrapSessionReturnsOnlyTheMintedCookiesWhenTheStorefrontIsUnknown() async throws {
		stubSessionMint()

		let cookies = try await makeAPI(storefront: nil).bootstrapSession()

		XCTAssertEqual(cookies.map(\.name), ["hutch_sid"])
	}

	func testNativeRequestsCarryTheStorefrontHeaderWhenTheStorefrontIsKnown() async throws {
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.collection(entitiesJSON: [])) }

		_ = try await makeAPI(storefront: StorefrontCountryCode(raw: "CHN")).loadReadlist(path: "/queue")

		let request = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first?.request)
		XCTAssertEqual(request.value(forHTTPHeaderField: AppConfig.storefrontHeader), "CHN")
	}

	func testNativeRequestsOmitTheStorefrontHeaderWhenTheStorefrontIsUnknown() async throws {
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.collection(entitiesJSON: [])) }

		_ = try await makeAPI(storefront: nil).loadReadlist(path: "/queue")

		let request = try XCTUnwrap(StubURLProtocol.records(path: "/queue").first?.request)
		XCTAssertNil(request.value(forHTTPHeaderField: AppConfig.storefrontHeader))
	}

	func testTheStoreKitStorefrontIsReadAsItsThreeLetterCountryCode() async {
		let code = await StorefrontCountryCode.current()

		XCTAssertTrue(code.map { $0.raw.count == 3 } ?? true, "StoreKit reports ISO 3166-1 alpha-3 codes, got \(String(describing: code))")
	}
}
