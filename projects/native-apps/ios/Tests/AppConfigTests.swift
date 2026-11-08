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

	func testLocalBaseURL() {
		XCTAssertEqual(ServerEnvironment.local.baseURL, "http://127.0.0.1:3000")
	}

	/// Pins the `#if STAGING` selection in `AppConfig` to the active compilation
	/// condition: the production suite compiles the `#else` arm, the `test-staging`
	/// smoke pass the `STAGING` arm. A mis-wired switch fails one of the two runs
	/// instead of slipping through with only the data-map values above checked.
	func testServerBaseURLMatchesActiveCompilationCondition() {
		#if STAGING
		XCTAssertEqual(AppConfig.serverBaseURL, ServerEnvironment.staging.baseURL)
		#elseif LOCAL_SERVER
		XCTAssertEqual(AppConfig.serverBaseURL, ServerEnvironment.local.baseURL)
		#else
		XCTAssertEqual(AppConfig.serverBaseURL, ServerEnvironment.production.baseURL)
		#endif
	}

	func testPrivacyPolicyURLIsServedByTheTargetedStack() {
		XCTAssertEqual(AppConfig.privacyPolicyURL.absoluteString, "\(AppConfig.serverBaseURL)/privacy")
	}

	/// The server reads this marker to decide it may answer with a `readplace://`
	/// control the web sheet can execute. Renaming either half silently drops the
	/// chromeless account page (and its sign-out) back to the full web shell, so the
	/// value is pinned here rather than left to a passing integration.
	func testAppShellQueryItemIsTheMarkerTheServerGatesOn() {
		XCTAssertEqual(AppConfig.appShellQueryItem.name, "shell")
		XCTAssertEqual(AppConfig.appShellQueryItem.value, "app")
	}

	func testNativeUserAgentNamesTheProductAndTheBuildItWasMadeFrom() {
		XCTAssertEqual(
			AppConfig.nativeUserAgent(
				product: "Readplace",
				build: "111",
				osVersion: OperatingSystemVersion(majorVersion: 26, minorVersion: 5, patchVersion: 0)
			),
			"Readplace/build-111 iOS/26.5",
			"the shape is a contract with the server, whose native-client pattern matches product/build-N iOS/major.minor and nothing else: a dropped build- prefix or a swapped separator logs every request from this build as an unrecognised client"
		)
	}

	func testNativeUserAgentNamesTheShareExtensionAsItsOwnProduct() {
		XCTAssertEqual(
			AppConfig.nativeUserAgent(
				product: "ShareExtension",
				build: "111",
				osVersion: OperatingSystemVersion(majorVersion: 26, minorVersion: 5, patchVersion: 0)
			),
			"ShareExtension/build-111 iOS/26.5",
			"the extension is a second binary that saves on its own, so a product name baked into the format would file every share-sheet save under the app and hide which of the two broke"
		)
	}

	func testNativeUserAgentKeepsThePatchVersionOutOfTheOSToken() {
		XCTAssertEqual(
			AppConfig.nativeUserAgent(
				product: "Readplace",
				build: "111",
				osVersion: OperatingSystemVersion(majorVersion: 26, minorVersion: 5, patchVersion: 1)
			),
			"Readplace/build-111 iOS/26.5",
			"a patch component that surfaces only on a non-zero patch release would split one OS version into an open set of user agents the server pattern has to keep chasing"
		)
	}
}
