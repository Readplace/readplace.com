import XCTest
@testable import Readplace

/// The server URL is fixed at compile time via `ServerEnvironment`. Because the
/// mapping is data-driven rather than an `#if` at the call site, both branches
/// are asserted here in a single (production) test build — no STAGING recompile.
final class AppConfigTests: XCTestCase {
	func testProductionBaseURL() {
		XCTAssertEqual(ServerEnvironment.production.baseURL, "https://readplace.com")
	}

	func testStagingBaseURL() {
		XCTAssertEqual(
			ServerEnvironment.staging.baseURL,
			"https://hkncrxpii6.execute-api.ap-southeast-2.amazonaws.com"
		)
	}
}
