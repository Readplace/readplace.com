import XCTest
@testable import Readplace

/// The server URL is fixed at compile time via `ServerEnvironment`. The
/// data-driven mapping lets both branch *values* be asserted in one build, while
/// `testServerBaseURLMatchesActiveCompilationCondition` pins the `#if STAGING`
/// *selection* to whichever condition is compiled. `make test` runs this class
/// once per condition — the production suite plus the `test-staging` smoke pass —
/// so the staging branch is compiled and its selection checked on every CI run.
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

	/// Pins the `#if STAGING` selection in `AppConfig` to the active compilation
	/// condition: the production suite compiles the `#else` arm, the `test-staging`
	/// smoke pass the `STAGING` arm. A mis-wired switch fails one of the two runs
	/// instead of slipping through with only the data-map values above checked.
	func testServerBaseURLMatchesActiveCompilationCondition() {
		#if STAGING
		XCTAssertEqual(AppConfig.serverBaseURL, ServerEnvironment.staging.baseURL)
		#else
		XCTAssertEqual(AppConfig.serverBaseURL, ServerEnvironment.production.baseURL)
		#endif
	}

	func testPrivacyPolicyURLIsServedByTheTargetedStack() {
		XCTAssertEqual(AppConfig.privacyPolicyURL.absoluteString, "\(AppConfig.serverBaseURL)/privacy")
	}
}
